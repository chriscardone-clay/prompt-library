import { headers } from "next/headers";

/**
 * Configured public origin of the app, used as a fallback when the request
 * host is unavailable. Order: explicit NEXT_PUBLIC_SITE_URL → Vercel
 * production URL → Vercel preview URL → localhost.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;
  const preview = process.env.VERCEL_URL?.trim();
  if (preview) return `https://${preview}`;
  return "http://localhost:3000";
}

/**
 * Origin the current request was made to (custom domain, *.vercel.app,
 * localhost…). Used so OAuth returns users to the host they started on.
 * Falls back to getSiteUrl() outside a request.
 */
export async function getRequestOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return getSiteUrl();
    const proto =
      h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  } catch {
    return getSiteUrl();
  }
}
