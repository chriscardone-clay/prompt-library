/**
 * Who can see workflows while they're in beta. WORKFLOWS_BETA is either a
 * boolean (`true` / `1` / `on` = everyone signed in; `false` / `0` / `off` =
 * admins only) or a comma-separated list of emails (`a@clay.com`), whole
 * domains (`@clay.com`), or `*` for everyone. Admins always see them (see
 * workflowsEnabled in data.ts). Unset = admins only.
 */
export function workflowsAllowedByEnv(email: string | null | undefined): boolean {
  const raw = (process.env.WORKFLOWS_BETA ?? "").trim().toLowerCase();
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
