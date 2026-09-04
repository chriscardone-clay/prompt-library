import "server-only";

/**
 * Slack lookups. Needs a bot token with the `users:read` and
 * `users:read.email` scopes in SLACK_BOT_TOKEN. Without one, every function
 * here is a no-op so the app keeps working with initials avatars.
 */

const TOKEN = process.env.SLACK_BOT_TOKEN?.trim() || "";
const TIMEOUT_MS = 4000;

export const slackConfigured = () => TOKEN.length > 0;

interface LookupResponse {
  ok: boolean;
  error?: string;
  user?: {
    deleted?: boolean;
    profile?: {
      image_192?: string;
      image_512?: string;
      is_custom_image?: boolean;
    };
  };
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` }, signal: ctrl.signal, cache: "no-store" },
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as LookupResponse;
    if (!json.ok) {
      // users_not_found is a real answer; everything else is our problem.
      if (json.error === "users_not_found") return null;
      console.warn(`[slack] users.lookupByEmail failed: ${json.error}`);
      return undefined;
    }
    const p = json.user?.profile;
    if (!p || json.user?.deleted || p.is_custom_image === false) return null;
    return p.image_192 || p.image_512 || null;
  } catch (err) {
    console.warn("[slack] lookup error", err instanceof Error ? err.message : err);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
