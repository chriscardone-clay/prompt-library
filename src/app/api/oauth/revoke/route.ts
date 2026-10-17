import { json, preflight, readParams } from "@/lib/mcp/http";
import { revokeToken } from "@/lib/mcp/oauth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** RFC 7009: always 200, whether or not the token existed. */
export async function POST(request: Request) {
  const p = await readParams(request);
  await revokeToken(createServiceClient(), p.token ?? "").catch((err) => console.error("[oauth] revoke failed", err));
  return json({});
}
export const OPTIONS = preflight;
