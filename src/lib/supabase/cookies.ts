/**
 * Session cookie attributes shared by the server and proxy clients.
 *
 * There are two cookie jars, chosen per request:
 *
 * - Top level (the normal site): a plain first-party cookie, SameSite=Lax,
 *   under its own name. Not Partitioned: Safari (macOS and iOS) drops
 *   partitioned cookies after a multi-hop cross-site redirect chain, which is
 *   exactly Google → Supabase → /auth/callback, so the session vanished on
 *   the next navigation or server action
 *   (https://bugs.webkit.org/show_bug.cgi?id=306194).
 * - Embedded (a Notion page): SameSite=None + Partitioned (CHIPS), stored in
 *   the (notion.so, us) partition, which browsers that block third-party
 *   cookies still allow. The embed signs in on its own (see
 *   src/app/login/EmbedSignIn.tsx) and /auth/embed-callback drops a
 *   partitioned marker cookie so later requests from the frame use this jar.
 *
 * The jars use different cookie names so a browser holding both never sends
 * two cookies with the same name.
 */
const TOP_LEVEL = {
  name: "cp-auth",
  sameSite: "lax" as const,
  secure: true,
  path: "/",
};

const EMBEDDED = {
  sameSite: "none" as const,
  secure: true,
  path: "/",
  partitioned: true,
};

/** Partitioned marker set when the embed signs in; only visible inside the frame's partition. */
export const EMBED_MARKER = "cp-embed";

export const embedMarkerOptions = {
  ...EMBEDDED,
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 400,
};

export function cookieOptionsFor(embedded: boolean) {
  return embedded ? EMBEDDED : TOP_LEVEL;
}

export function isEmbeddedRequest(cookies: { has(name: string): boolean }) {
  return cookies.has(EMBED_MARKER);
}
