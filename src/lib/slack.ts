import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack Web API. Needs a bot token in SLACK_BOT_TOKEN with:
 *   users:read, users:read.email  – look people up by email (avatars, test DMs)
 *   chat:write                    – post the weekly digest / DMs / replies
 *   im:write                      – open the DM used by "Send test to me"
 *   app_mentions:read, im:history – receive @mentions and DMs (Events API)
 * Without a token every function here is a no-op / returns a clear error, so
 * the app keeps working with initials avatars and no digest.
 */

const TOKEN = process.env.SLACK_BOT_TOKEN?.trim() || "";
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET?.trim() || "";
const TIMEOUT_MS = 6000;

export const slackConfigured = () => TOKEN.length > 0;
export const slackEventsConfigured = () => SIGNING_SECRET.length > 0;

/**
 * Verify a request really came from Slack (Events API / interactivity):
 * HMAC-SHA256 of "v0:<timestamp>:<raw body>" with the app's signing secret,
 * and a five-minute replay window.
 */
export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  if (!SIGNING_SECRET || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = "v0=" + createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ThreadMessage {
  user: string | null;
  bot: boolean;
  text: string;
  ts: string;
}

/**
 * The messages of a thread, oldest first (root included). Needs channels:history
 * (public channels), groups:history (private), im:history / mpim:history (DMs).
 * Returns null when the thread can't be read (missing scope, deleted, etc.).
 */
export async function fetchThread(channel: string, threadTs: string, limit = 25): Promise<ThreadMessage[] | null> {
  const r = await slackApi<{ messages?: { user?: string; bot_id?: string; text?: string; ts: string; subtype?: string }[] }>(
    "conversations.replies",
    undefined,
    { channel, ts: threadTs, limit: String(limit), inclusive: "true" },
  );
  if (!r.ok || !r.messages) return null;
  return r.messages
    .filter((m) => !m.subtype || m.subtype === "bot_message")
    .map((m) => ({ user: m.user ?? null, bot: !!m.bot_id, text: m.text ?? "", ts: m.ts }));
}

/** Display name for a Slack user id (for the model's benefit); null if unknown. */
export async function lookupSlackUserName(userId: string): Promise<string | null> {
  const r = await slackApi<{ user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } } }>("users.info", undefined, { user: userId });
  if (!r.ok) return null;
  return r.user?.profile?.display_name || r.user?.real_name || r.user?.profile?.real_name || null;
}

type SlackResponse<T> = ({ ok: true } & T) | { ok: false; error: string; needed?: string; provided?: string };

async function slackApi<T>(method: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<SlackResponse<T>> {
  if (!slackConfigured()) return { ok: false, error: "slack_not_configured" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    const res = await fetch(`https://slack.com/api/${method}${qs}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as SlackResponse<T>;
    if (!json.ok) console.warn(`[slack] ${method} failed: ${json.error}${json.needed ? ` (needs scope ${json.needed})` : ""}`);
    return json;
  } catch (err) {
    console.warn(`[slack] ${method} error`, err instanceof Error ? err.message : err);
    return { ok: false, error: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Human wording for the Slack error codes admins are likely to hit. */
export function slackErrorText(code: string): string {
  const map: Record<string, string> = {
    slack_not_configured: "SLACK_BOT_TOKEN isn't set on the server.",
    missing_scope: "The Slack app is missing a scope. Add chat:write (and im:write for DMs), then reinstall the app.",
    not_in_channel: "The bot isn't in that channel yet. Run /invite @<app name> in the channel, or add the chat:write.public scope.",
    missing_scope_history: "The Slack app can't read threads. Add the channels:history and groups:history scopes, then reinstall the app.",
    channel_not_found: "That channel ID doesn't exist or the bot can't see it. Use the ID from the channel's About tab (starts with C).",
    users_not_found: "Slack has no account with that email.",
    invalid_auth: "The Slack token was rejected. It may have rotated when the app was reinstalled.",
    network_error: "Couldn't reach Slack. Try again.",
    ratelimited: "Slack rate-limited the request. Wait a minute and try again.",
  };
  return map[code] ?? `Slack error: ${code}`;
}

interface LookupUser {
  user?: { id: string; deleted?: boolean; profile?: { image_192?: string; image_512?: string; is_custom_image?: boolean } };
}

/** Slack user id for an email, or null when unknown / not configured. */
export async function lookupSlackUserId(email: string): Promise<string | null> {
  const r = await slackApi<LookupUser>("users.lookupByEmail", undefined, { email });
  return r.ok && r.user && !r.user.deleted ? r.user.id : null;
}

/**
 * The person's Slack photo URL.
 *  - a URL when they have uploaded a photo
 *  - null when Slack knows them but they use a default avatar (initials look better)
 *  - undefined when we couldn't find out (no token, network error, bad token,
 *    rate limit) — callers should not record an attempt in that case
 */
export async function lookupSlackAvatar(email: string): Promise<string | null | undefined> {
  if (!slackConfigured()) return undefined;
  const r = await slackApi<LookupUser>("users.lookupByEmail", undefined, { email });
  if (!r.ok) return r.error === "users_not_found" ? null : undefined;
  const p = r.user?.profile;
  if (!p || r.user?.deleted || p.is_custom_image === false) return null;
  return p.image_192 || p.image_512 || null;
}

export interface SlackMessage {
  blocks: Record<string, unknown>[];
  text: string;
}

/** Post a Block Kit message. `channel` is a channel id (C…) or a DM id (D…). Pass `threadTs` to reply in a thread. */
export async function postSlackMessage(
  channel: string,
  message: SlackMessage,
  threadTs?: string,
): Promise<{ ok: true; ts: string; channel: string } | { ok: false; error: string }> {
  const r = await slackApi<{ ts: string; channel: string }>("chat.postMessage", {
    channel,
    text: message.text,
    blocks: message.blocks,
    unfurl_links: false,
    unfurl_media: false,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return r.ok ? { ok: true, ts: r.ts, channel: r.channel } : { ok: false, error: r.error };
}

/** Open (or find) the bot's DM with the person behind an email. Needs im:write. */
export async function openSlackDm(email: string): Promise<{ ok: true; channel: string } | { ok: false; error: string }> {
  const userId = await lookupSlackUserId(email);
  if (!userId) return { ok: false, error: "users_not_found" };
  const r = await slackApi<{ channel: { id: string } }>("conversations.open", { users: userId });
  return r.ok ? { ok: true, channel: r.channel.id } : { ok: false, error: r.error };
}
