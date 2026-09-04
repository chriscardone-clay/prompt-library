/**
 * Session cookie attributes shared by the server, browser and proxy clients.
 *
 * SameSite=None (with Secure) lets the browser send the session when the app
 * is embedded in an iframe on another site, such as a Notion page. With the
 * default Lax, embeds would always render as signed out.
 */
export const cookieOptions = {
  sameSite: "none" as const,
  secure: true,
  path: "/",
};
