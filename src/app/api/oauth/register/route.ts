import { json, preflight } from "@/lib/mcp/http";
import { OAuthError, registerClient } from "@/lib/mcp/oauth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** Dynamic client registration (RFC 7591). Claude registers itself here the first time someone connects. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    return json(await registerClient(createServiceClient(), body), 201);
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    console.error("[oauth] register failed", err);
    return json({ error: "server_error" }, 500);
  }
}
export const OPTIONS = preflight;
