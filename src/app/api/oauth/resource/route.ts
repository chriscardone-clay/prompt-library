import { json, originOf, preflight } from "@/lib/mcp/http";
import { protectedResourceMetadata } from "@/lib/mcp/oauth";

// Served at /.well-known/oauth-protected-resource[/api/mcp] (rewrite in next.config.ts).
export function GET(request: Request) {
  return json(protectedResourceMetadata(originOf(request)), 200, { "Cache-Control": "public, max-age=3600" });
}
export const OPTIONS = preflight;
