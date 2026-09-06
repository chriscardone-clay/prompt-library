import { after, NextResponse, type NextRequest } from "next/server";
import type { ThreadContext } from "@/lib/agent/answer";
import { handleAsk, stripMentions } from "@/lib/agent/handle";
import { buildHomeBlocks, SUGGESTED_PROMPTS } from "@/lib/agent/home";
import {
  assistantSetStatus,
  assistantSetSuggestedPrompts,
  assistantSetTitle,
  fetchThread,
  lookupSlackUserEmail,
  lookupSlackUserName,
  postSlackMessage,
  publishHomeView,
  slackEventsConfigured,
  verifySlackRequest,
} from "@/lib/slack";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Slack Events API endpoint. Configure it as the Request URL under
 * Event Subscriptions and subscribe the bot to `app_mention` and `message.im`.
 *
 * Slack expects a 2xx within 3 seconds, so we verify, dedupe and acknowledge
 * immediately, then do the library lookup + model call + reply in `after()`.
 */
interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  /** app_home_opened */
  tab?: string;
  /** assistant_thread_started / assistant_thread_context_changed */
  assistant_thread?: { channel_id: string; thread_ts: string; user_id?: string };
}
interface SlackEnvelope {
  type: string;
  challenge?: string;
  event_id?: string;
  event?: SlackEvent;
  authorizations?: { user_id?: string; is_bot?: boolean }[];
}

export async function POST(request: NextRequest) {
  if (!slackEventsConfigured()) {
    return NextResponse.json({ error: "SLACK_SIGNING_SECRET is not set" }, { status: 500 });
  }
  const raw = await request.text();
  const ok = verifySlackRequest(raw, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"));
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: SlackEnvelope;
  try {
    body = JSON.parse(raw) as SlackEnvelope;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // One-time handshake when the Request URL is saved in the Slack app config.
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  if (body.type !== "event_callback" || !body.event) return NextResponse.json({ ok: true });

  // Slack retries when we're slow; we always answer fast, so retries are duplicates.
  if (request.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true, ignored: "retry" });

  const ev = body.event;
  const botUserId = body.authorizations?.find((a) => a.is_bot)?.user_id ?? body.authorizations?.[0]?.user_id;

  // ── App Home tab: publish a fresh view each time someone opens it ──
  if (ev.type === "app_home_opened") {
    if (ev.tab !== "home" || !ev.user) return NextResponse.json({ ok: true, ignored: "not-home-tab" });
    const service = createServiceClient();
    if (body.event_id) {
      const { error } = await service.from("slack_events").insert({ event_id: body.event_id });
      if (error) return NextResponse.json({ ok: true, ignored: "duplicate" });
    }
    const homeUser = ev.user;
    after(async () => {
      try {
        const email = await lookupSlackUserEmail(homeUser);
        const blocks = await buildHomeBlocks(service, email);
        const r = await publishHomeView(homeUser, blocks);
        if (!r.ok) console.error("[home] publish failed", r.error);
      } catch (err) {
        console.error("[home] failed", err instanceof Error ? err.message : err);
      }
    });
    return NextResponse.json({ ok: true });
  }

  // ── Assistant pane opened: offer starter questions ──
  if (ev.type === "assistant_thread_started") {
    const t = ev.assistant_thread;
    if (!t) return NextResponse.json({ ok: true, ignored: "no-thread" });
    after(async () => {
      await assistantSetSuggestedPrompts(t.channel_id, t.thread_ts, SUGGESTED_PROMPTS, "What are you trying to do?");
      await postSlackMessage(
        t.channel_id,
        { blocks: [], text: "Hi! Tell me what you're working on and I'll find the prompts or skills in the library that fit — or say so if nothing does, so you can add one." },
        t.thread_ts,
      );
    });
    return NextResponse.json({ ok: true });
  }
  if (ev.type === "assistant_thread_context_changed") return NextResponse.json({ ok: true });

  const isMention = ev.type === "app_mention";
  const isDm = ev.type === "message" && ev.channel_type === "im";
  if (!isMention && !isDm) return NextResponse.json({ ok: true, ignored: ev.type });
  if (ev.bot_id || ev.subtype || !ev.user || ev.user === botUserId) return NextResponse.json({ ok: true, ignored: "bot-or-subtype" });
  const question = stripMentions(ev.text ?? "");
  if (!question) return NextResponse.json({ ok: true, ignored: "empty" });
  if (!ev.channel) return NextResponse.json({ ok: true, ignored: "no-channel" });

  const service = createServiceClient();
  if (body.event_id) {
    const { error } = await service.from("slack_events").insert({ event_id: body.event_id });
    if (error) return NextResponse.json({ ok: true, ignored: "duplicate" }); // primary key hit = already handled
  }

  const channel = ev.channel;
  const threadTs = isMention ? (ev.thread_ts ?? ev.ts) : ev.thread_ts; // channel: always thread; DM: only if already in a thread
  const user = ev.user;
  const eventId = body.event_id;

  // Mentioned inside an existing thread? Then the earlier messages matter.
  const inThread = !!ev.thread_ts && ev.thread_ts !== ev.ts;
  const mentionTs = ev.ts;

  after(async () => {
    try {
      // In the assistant pane, show "is searching…" while we work (needs assistant:write).
      if (isDm && threadTs) await assistantSetStatus(channel, threadTs, "is searching the library…");
      const [askerName, thread] = await Promise.all([
        lookupSlackUserName(user).then((n) => n ?? undefined),
        inThread && ev.thread_ts ? fetchThread(channel, ev.thread_ts) : Promise.resolve(null),
      ]);
      let threadContext: ThreadContext | undefined;
      if (inThread) {
        if (thread && thread.length) {
          const [root, ...rest] = thread;
          threadContext = {
            root: stripMentions(root.text),
            others: rest.filter((m) => m.ts !== mentionTs && !m.bot && m.text.trim()).map((m) => stripMentions(m.text)),
          };
        } else {
          // Can't read the thread (missing channels:history / groups:history?) — treat it as a long thread we can't parse.
          console.warn("[agent] thread unreadable; asking to restate", { channel, threadTs: ev.thread_ts });
          threadContext = { root: "", others: Array(99).fill("") };
        }
      }
      const handled = await handleAsk(service, {
        source: isMention ? "mention" : "dm",
        question,
        thread: threadContext,
        askerName,
        eventId,
        slackUser: user,
        channel,
        threadTs,
      });
      const posted = await postSlackMessage(channel, handled.message, threadTs);
      if (posted.ok && isDm && threadTs) await assistantSetTitle(channel, threadTs, question);
      if (!posted.ok) console.error("[agent] reply failed", posted.error, { channel, eventId });
      else console.log("[agent] replied", { channel, eventId, matches: handled.result.matches.length, fallback: handled.result.fallback, clarified: handled.clarified, inThread });
    } catch (err) {
      console.error("[agent] handling failed", err instanceof Error ? err.message : err, { channel, eventId });
      await postSlackMessage(
        channel,
        { blocks: [], text: "Sorry, I hit a snag looking that up. Try again in a minute, or search the library directly." },
        threadTs,
      );
    }
  });

  return NextResponse.json({ ok: true });
}
