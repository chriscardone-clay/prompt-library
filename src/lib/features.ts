/**
 * Fallback for feature flags where Vercel Flags isn't available (local
 * development, other hosts). On Vercel the flag in Vercel Flags decides, per
 * user (src/lib/flags.ts), and this is only used if evaluating it fails.
 *
 * The env var (e.g. WORKFLOWS_BETA, ENABLEMENT_APPROVED) is either a boolean
 * (`true` / `1` / `on` = everyone signed in; `false` / `0` / `off` / unset =
 * no one) or a comma-separated list of emails (`a@clay.com`), whole domains
 * (`@clay.com`), or `*` for everyone. Admins get no special treatment.
 */
export function allowedByEnv(name: string, email: string | null | undefined): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw || !email) return false;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  const e = email.trim().toLowerCase();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((entry) => entry === "*" || entry === e || (entry.startsWith("@") && e.endsWith(entry)));
}

/** Running where Vercel Flags can be evaluated: on Vercel (OIDC) or with a FLAGS SDK key. */
export function vercelFlagsAvailable(): boolean {
  return !!process.env.VERCEL || !!process.env.FLAGS?.trim();
}
