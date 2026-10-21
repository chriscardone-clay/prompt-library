import "server-only";
import { vercelAdapter } from "@flags-sdk/vercel";
import { dedupe, flag } from "flags/next";
import { getCurrentUser } from "./data";
import { allowedByEnv, vercelFlagsAvailable } from "./features";

/**
 * Who a flag is evaluated for. Define a `user` entity with `id` and `email` in
 * the Vercel Flags dashboard to target rules at people (e.g. user.email is one
 * of the Services testers).
 */
export type FlagEntities = { user?: { id: string; email: string } };

const identify = dedupe(async (): Promise<FlagEntities> => {
  const user = await getCurrentUser();
  return user ? { user: { id: user.id, email: user.email.toLowerCase() } } : {};
});

/**
 * Booleans in Vercel Flags, targeted per person in the dashboard. Nobody is
 * on by default, admins included: add yourself to a flag's rules to opt in,
 * remove yourself to opt out. With FLAGS_SECRET set, the Vercel Toolbar can
 * also override a flag for your browser (/.well-known/vercel/flags).
 * The *_FLAG_KEY env vars override the keys.
 */
export const workflowsBeta = flag<boolean, FlagEntities>({
  key: process.env.WORKFLOWS_FLAG_KEY?.trim() || "WORKFLOWS_BETA",
  description: "Workflows (beta): Clay Workflows reference architectures in the library",
  adapter: vercelAdapter,
  defaultValue: false,
  options: [false, true],
  identify,
});

export const enablementApproved = flag<boolean, FlagEntities>({
  key: process.env.ENABLEMENT_FLAG_KEY?.trim() || "ENABLEMENT_APPROVED",
  description: "Enablement Approved: gold standards, approval badges, the review queue and approval-boosted ranking",
  adapter: vercelAdapter,
  defaultValue: false,
  options: [false, true],
  identify,
});

export const mcpConnector = flag<boolean, FlagEntities>({
  key: process.env.CONNECTOR_FLAG_KEY?.trim() || "MCP_CONNECTOR",
  description: "Claude / ChatGPT / Cursor connector (MCP): /connect, connecting an app, and every request to /api/mcp",
  adapter: vercelAdapter,
  defaultValue: false,
  options: [false, true],
  identify,
});

export type FeatureName = "workflows" | "enablement" | "connector";

const FEATURES = {
  workflows: { flag: workflowsBeta, env: "WORKFLOWS_BETA" },
  enablement: { flag: enablementApproved, env: "ENABLEMENT_APPROVED" },
  connector: { flag: mcpConnector, env: "MCP_CONNECTOR" },
} as const;

/**
 * Is a feature on for this person? Vercel Flags decides wherever it's
 * available; the env var is the fallback for local development and for when
 * Vercel Flags can't be reached. Pass `user` to evaluate outside a signed-in
 * request (the Claude connector, the Slack assistant).
 */
export async function featureOn(name: FeatureName, user?: { id: string; email: string } | null): Promise<boolean> {
  const { flag: f, env } = FEATURES[name];
  const who = user === undefined ? await getCurrentUser() : user;
  if (!who) return false;
  if (vercelFlagsAvailable()) {
    try {
      return user === undefined ? await f() : await f.run({ identify: { user: { id: who.id, email: who.email.toLowerCase() } } });
    } catch (err) {
      console.warn(`[flags] ${f.key} unavailable, using the ${env} env var:`, err instanceof Error ? err.message : err);
    }
  }
  return allowedByEnv(env, who.email);
}
