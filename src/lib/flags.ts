import "server-only";
import { vercelAdapter } from "@flags-sdk/vercel";
import { dedupe, flag } from "flags/next";
import { getCurrentUser } from "./data";

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
 * The Workflows beta: a boolean in Vercel Flags, targeted per person in the
 * dashboard. Falls back to false when Vercel Flags can't be reached or isn't
 * set up (local dev without `vercel env pull`). Admins always see workflows
 * regardless (workflowsEnabled in data.ts). WORKFLOWS_FLAG_KEY overrides the key.
 */
export const workflowsBeta = flag<boolean, FlagEntities>({
  key: process.env.WORKFLOWS_FLAG_KEY?.trim() || "WORKFLOWS_BETA",
  description: "Workflows (beta): Clay Workflows reference architectures in the library",
  adapter: vercelAdapter,
  defaultValue: false,
  identify,
});
