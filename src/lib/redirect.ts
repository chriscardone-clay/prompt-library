/**
 * A same-site path to continue to after sign-in, or "/".
 *
 * A prefix check isn't enough: browsers treat "/\evil.example" as
 * "//evil.example" and drop tabs and newlines, so resolve the value the way
 * the browser will and keep it only if it stays on our origin.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return "/";
  const base = "http://same-site.invalid";
  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
