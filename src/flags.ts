import "server-only";
import { vercelAdapter } from "@flags-sdk/vercel";
import { dedupe, flag } from "flags/next";
import { createClient } from "@/lib/supabase/server";

/**
 * Feature flags, managed in Vercel Flags (Vercel dashboard → this project →
 * Flags). Targeting rules, segments ("Beta testers") and percentage rollouts
 * are set there, per environment; this file only declares the flags and who
 * is asking.
 *
 * Entities: `user.id` (stable, use it as the base for percentage rollouts)
 * and `user.email` (use it for named people and segments).
 *
 * Defaults: on a Vercel deployment a flag is off until the dashboard says
 * otherwise (and if Vercel Flags can't be reached), so declaring a flag here
 * never ships the feature by itself. Off Vercel (local dev, no Flags
 * credentials) flags default on so you can work on the feature; list keys in
 * FLAGS_LOCAL_OFF to see their off state, or `vercel env pull` to test real
 * targeting locally.
 *
 * Pages and Server Actions call a flag directly (`await mcpConnector()`); it
 * reads the signed-in person from the session. Code that knows the person
 * some other way (the MCP connector's bearer token, the Slack assistant) uses
 * `flagFor(flag, user)` instead.
 */

export interface FlagEntities {
  user?: { id: string; email: string };
}

const OFF_VERCEL_DEFAULT = !process.env.VERCEL_ENV;
/** Credentials for Vercel Flags: OIDC on deployments (or after `vercel env pull`), or an SDK key in FLAGS. */
const HAS_FLAGS_CREDENTIALS = !!(process.env.VERCEL_ENV || process.env.VERCEL_OIDC_TOKEN || process.env.FLAGS);

/** Who is asking, from the Supabase session (pages, Server Actions, route handlers with cookies). */
const identify = dedupe(async (): Promise<FlagEntities> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  return id && email ? { user: { id, email } } : {};
});

/** Local only: flags to treat as off without credentials, e.g. FLAGS_LOCAL_OFF="mcp-write" to see the off state. */
const LOCAL_OFF = new Set((process.env.FLAGS_LOCAL_OFF ?? "").split(",").map((k) => k.trim()).filter(Boolean));

const ON_OFF = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

/** An on/off flag. Without credentials it skips the adapter (which would fail and log on every call) and returns the default. */
function booleanFlag(key: string, description: string) {
  const common = { key, description, identify, defaultValue: OFF_VERCEL_DEFAULT, options: ON_OFF };
  return HAS_FLAGS_CREDENTIALS
    ? flag<boolean, FlagEntities>({ ...common, adapter: vercelAdapter<boolean, FlagEntities>() })
    : flag<boolean, FlagEntities>({ ...common, decide: () => OFF_VERCEL_DEFAULT && !LOCAL_OFF.has(key) });
}

/** The MCP connector for Claude and ChatGPT: /api/mcp, the consent screen, /connect and its menu item. */
export const mcpConnector = booleanFlag("mcp-connector", "Claude / ChatGPT connector: /api/mcp, /oauth/authorize, /connect and the account-menu link");

/** Saving and editing prompts and skills from chat (start_saving, preview_item, create_item, preview_changes, update_item). */
export const mcpWrite = booleanFlag("mcp-write", "Connector tools that save and edit prompts and skills from chat");

type BooleanFlag = typeof mcpConnector;

/**
 * Evaluate a flag for a known person, outside a browser session (bearer-token
 * or Slack requests). Passing a request with no cookies means Flags Explorer
 * overrides don't apply here, only the dashboard's targeting.
 */
export function flagFor(f: BooleanFlag, user: { id: string; email: string }): Promise<boolean> {
  return f.run({
    identify: { user: { id: user.id, email: user.email.toLowerCase() } },
    request: new Request("https://flags.invalid/"),
  });
}
