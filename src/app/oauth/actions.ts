"use server";

import { redirect } from "next/navigation";
import { mcpConnector } from "@/flags";
import { getCurrentUser } from "@/lib/data";
import { issueCode, parseAuthorize } from "@/lib/mcp/oauth";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"] as const;

/** Approve or deny a connector sign-in from /oauth/authorize. Re-validates everything the form carried. */
export async function decideAuthorization(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params: Record<string, string | undefined> = {};
  for (const f of FIELDS) {
    const v = formData.get(f);
    if (typeof v === "string") params[f] = v;
  }
  const service = createServiceClient();
  const parsed = await parseAuthorize(service, params);
  if (!parsed.ok) redirect("redirect" in parsed ? parsed.redirect : "/connect?error=client");

  const back = new URL(parsed.req.redirectUri);
  if (parsed.req.state) back.searchParams.set("state", parsed.req.state);
  if (formData.get("decision") !== "allow" || !(await mcpConnector())) {
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("error_description", "The person declined.");
    redirect(back.toString());
  }
  back.searchParams.set("code", await issueCode(service, parsed.req, user.id));
  redirect(back.toString());
}

/** Revoke one of your own connector grants (RLS limits it to yours). */
export async function revokeGrant(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  const supabase = await createClient();
  await supabase.from("mcp_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  redirect("/connect?revoked=1");
}
