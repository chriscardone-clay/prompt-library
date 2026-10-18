import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { flagFor, mcpConnector, mcpWrite } from "@/flags";
import { CORS, originOf, preflight } from "@/lib/mcp/http";
import { verifyAccessToken } from "@/lib/mcp/oauth";
import { buildServer } from "@/lib/mcp/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The MCP connector (Streamable HTTP, stateless: a fresh server per request,
 * JSON responses, no sessions). Add https://www.clayprompts.com/api/mcp as a
 * custom connector in Claude; it signs in through /oauth/authorize.
 */
async function handle(request: Request): Promise<Response> {
  const origin = originOf(request);
  const unauthorized = (description: string) =>
    new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
      status: 401,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="clayprompts", error="invalid_token", error_description="${description}", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    });

  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) return unauthorized("Sign in to connect the Clay prompt library.");

  const service = createServiceClient();
  const me = await verifyAccessToken(service, token);
  if (!me) return unauthorized("The token is invalid, expired or revoked.");

  // Rolled out with Vercel Flags (src/flags.ts): people outside the rollout get a clear refusal.
  const [enabled, canSave] = await Promise.all([flagFor(mcpConnector, me), flagFor(mcpWrite, me)]);
  if (!enabled) {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "The Clay prompt library connector isn't available to you yet." }, id: null }),
      { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const server = buildServer(service, me, origin, { canSave });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(request, {
      authInfo: { token, clientId: me.clientId, scopes: me.scope.split(" ").filter(Boolean), expiresAt: me.expiresAt, extra: { userId: me.id } },
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    // Read the body before closing so the response isn't cut short.
    const body = await res.arrayBuffer();
    return new Response(body.byteLength ? body : null, { status: res.status, headers });
  } catch (err) {
    console.error("[mcp] request failed", err);
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = preflight;
