import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esc } from "@/lib/digest/blocks";
import { getSiteUrl } from "@/lib/site";
import { openSlackDm, postSlackMessage, slackConfigured } from "@/lib/slack";

/** Slack DMs for feedback, shared by the Server Actions and the connector. Best effort. */

type Db = SupabaseClient;

export async function nameAndEmail(supabase: Db, id: string): Promise<{ name: string; email: string } | null> {
  const { data } = await supabase.from("profiles").select("name, email").eq("id", id).maybeSingle();
  return (data as { name: string; email: string } | null) ?? null;
}

export function quote(s: string, max = 280): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Tell the owner someone left feedback (unless they left it themselves). */
export async function notifyFeedbackPosted(supabase: Db, promptId: string, authorId: string, text: string) {
  if (!slackConfigured()) return;
  try {
    const { data: p } = await supabase.from("prompts").select("title, owner_id, kind").eq("id", promptId).maybeSingle();
    const prompt = p as { title: string; owner_id: string; kind: string } | null;
    if (!prompt || prompt.owner_id === authorId) return;
    const [owner, author] = await Promise.all([nameAndEmail(supabase, prompt.owner_id), nameAndEmail(supabase, authorId)]);
    if (!owner) return;
    const dm = await openSlackDm(owner.email);
    if (!dm.ok) return console.warn("[slack] feedback DM: no DM channel", dm.error);
    const url = `${getSiteUrl()}/prompts/${promptId}#feedback`;
    const kind = prompt.kind === "skill" ? "skill" : "prompt";
    const who = author?.name ?? "Someone";
    const msg = {
      text: `${who} left feedback on your ${kind} “${prompt.title}”: ${quote(text)}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `💬 *${esc(who)}* left feedback on your ${kind} *<${url}|${esc(prompt.title)}>*` } },
        { type: "section", text: { type: "mrkdwn", text: `> ${esc(quote(text)).replace(/\n/g, "\n> ")}` } },
        {
          type: "actions",
          elements: [{ type: "button", text: { type: "plain_text", text: "Reply in the library" }, url, action_id: "open_feedback" }],
        },
      ],
    };
    const r = await postSlackMessage(dm.channel, msg);
    if (!r.ok) console.warn("[slack] feedback DM failed", r.error);
  } catch (err) {
    console.warn("[slack] feedback DM error", err instanceof Error ? err.message : err);
  }
}

