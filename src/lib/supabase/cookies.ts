/**
 * Session cookie attributes shared by the server, browser and proxy clients.
 *
 * - SameSite=None + Secure: the cookie may be sent when the app is embedded
 *   in an iframe on another site (a Notion page).
 * - Partitioned (CHIPS): the cookie is stored per top-level site. At the top
 *   level that is simply our own site, so nothing changes there. Inside a
 *   Notion embed the session lives in the (notion.so, us) partition, which
 *   browsers that block third-party cookies still allow. The embed therefore
 *   signs in once on its own (see src/app/login/EmbedSignIn.tsx) instead of
 *   depending on cookies leaking across sites.
 */
export const cookieOptions = {
  sameSite: "none" as const,
  secure: true,
  path: "/",
  partitioned: true,
};
