import { json, preflight, readParams } from "@/lib/mcp/http";
import { exchangeCode, OAuthError, refreshGrant } from "@/lib/mcp/oauth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const p = await readParams(request);
  const service = createServiceClient();
  try {
    if (p.grant_type === "authorization_code") {
      return json(await exchangeCode(service, { code: p.code ?? "", redirectUri: p.redirect_uri ?? "", clientId: p.client_id ?? "", verifier: p.code_verifier ?? "" }));
    }
    if (p.grant_type === "refresh_token") {
      return json(await refreshGrant(service, { refreshToken: p.refresh_token ?? "", clientId: p.client_id ?? "" }));
    }
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    console.error("[oauth] token failed", err);
    return json({ error: "server_error" }, 500);
  }
}
export const OPTIONS = preflight;
