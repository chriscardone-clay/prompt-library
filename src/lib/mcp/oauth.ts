import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";

/**
 * The app as a small OAuth 2.1 authorization server for the MCP connector
 * (see supabase/migrations/0020_mcp_connector.sql). Public clients only:
 * dynamic registration, authorization code + PKCE (S256), refresh-token
 * rotation. Every function takes the service client; callers never hand it to
 * anything else.
 */

export const MCP_SCOPE = "library:read";
const CODE_TTL_S = 5 * 60;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;

export class OAuthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata" | "access_denied",
    message: string,
  ) {
    super(message);
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

function secret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function oauthMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Clay prompt library",
  };
}

// ── Registration ────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere, or http on loopback (native clients like Claude Code). No fragments. */
function validRedirect(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(service: SupabaseClient, body: unknown) {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Provide 1–10 redirect_uris.");
  const bad = uris.find((u) => !validRedirect(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${bad}. Use https, or http on localhost.`);
  const method = typeof b.token_endpoint_auth_method === "string" ? b.token_endpoint_auth_method : "none";
  if (method !== "none") throw new OAuthError("invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are supported.");
  const name = (typeof b.client_name === "string" ? b.client_name : "").trim().slice(0, 200);

  const clientId = `mcp_${randomBytes(16).toString("base64url")}`;
  const { error } = await service.from("mcp_clients").insert({ client_id: clientId, client_name: name, redirect_uris: uris });
  if (error) throw new Error(`registerClient: ${error.message}`);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name || undefined,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: MCP_SCOPE,
  };
}

export interface McpClient {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export async function getClient(service: SupabaseClient, clientId: string): Promise<McpClient | null> {
  if (!clientId) return null;
  const { data } = await service.from("mcp_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  const r = data as { client_id: string; client_name: string; redirect_uris: string[] };
  return { clientId: r.client_id, name: r.client_name, redirectUris: r.redirect_uris };
}

/** Exact match, except loopback redirects may use any port (RFC 8252 §7.3). */
export function redirectAllowed(client: McpClient, uri: string): boolean {
  if (client.redirectUris.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) return false;
    return client.redirectUris.some((r) => {
      const v = new URL(r);
      return v.protocol === "http:" && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
    });
  } catch {
    return false;
  }
}

// ── Authorization request ───────────────────────────────────────────

export interface AuthorizeRequest {
  client: McpClient;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
}

/**
 * Validate /oauth/authorize parameters. Errors about the client or redirect
 * are shown on the page (never redirected to an unverified URI); the rest go
 * back to the client as ?error=.
 */
export async function parseAuthorize(
  service: SupabaseClient,
  params: Record<string, string | undefined>,
): Promise<{ ok: true; req: AuthorizeRequest } | { ok: false; show: string } | { ok: false; redirect: string }> {
  const client = await getClient(service, params.client_id ?? "");
  if (!client) return { ok: false, show: "This app isn't registered with the prompt library. Remove the connector and add it again." };
  const redirectUri = params.redirect_uri ?? "";
  if (!redirectAllowed(client, redirectUri)) return { ok: false, show: "The app asked to return to an address it didn't register." };

  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (params.state) u.searchParams.set("state", params.state);
    return { ok: false as const, redirect: u.toString() };
  };
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required.");
  return {
    ok: true,
    req: { client, redirectUri, state: params.state ?? "", codeChallenge: params.code_challenge, scope: MCP_SCOPE },
  };
}

export async function issueCode(service: SupabaseClient, req: AuthorizeRequest, userId: string): Promise<string> {
  const code = secret("cpc");
  const { error } = await service.from("mcp_auth_codes").insert({
    code_hash: sha256(code),
    client_id: req.client.clientId,
    user_id: userId,
    redirect_uri: req.redirectUri,
    code_challenge: req.codeChallenge,
    scope: req.scope,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) throw new Error(`issueCode: ${error.message}`);
  // Opportunistic cleanup of stale codes.
  await service.from("mcp_auth_codes").delete().lt("expires_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  return code;
}

// ── Token endpoint ──────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function freshPair() {
  const access = secret("cpa");
  const refresh = secret("cpr");
  const now = Date.now();
  return {
    access,
    refresh,
    row: {
      access_hash: sha256(access),
      access_expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString(),
      refresh_hash: sha256(refresh),
      refresh_expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString(),
    },
  };
}

export async function exchangeCode(
  service: SupabaseClient,
  p: { code: string; redirectUri: string; clientId: string; verifier: string },
): Promise<TokenResponse> {
  if (!p.code || !p.verifier) throw new OAuthError("invalid_request", "code and code_verifier are required.");
  // Mark used atomically: only one exchange can claim a code.
  const { data, error } = await service
    .from("mcp_auth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", sha256(p.code))
    .is("used_at", null)
    .select("client_id, user_id, redirect_uri, code_challenge, scope, expires_at")
    .maybeSingle();
  if (error) throw new Error(`exchangeCode: ${error.message}`);
  const row = data as { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; expires_at: string } | null;
  if (!row) throw new OAuthError("invalid_grant", "The code is invalid or was already used.");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "The code has expired.");
  if (row.client_id !== p.clientId) throw new OAuthError("invalid_grant", "The code was issued to another client.");
  if (row.redirect_uri !== p.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request.");
  if (sha256(p.verifier) !== row.code_challenge) throw new OAuthError("invalid_grant", "PKCE verification failed.");

  const pair = freshPair();
  const ins = await service.from("mcp_grants").insert({ client_id: row.client_id, user_id: row.user_id, scope: row.scope, ...pair.row });
  if (ins.error) throw new Error(`exchangeCode grant: ${ins.error.message}`);
  return { access_token: pair.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: pair.refresh, scope: row.scope };
}

export async function refreshGrant(service: SupabaseClient, p: { refreshToken: string; clientId: string }): Promise<TokenResponse> {
  if (!p.refreshToken) throw new OAuthError("invalid_request", "refresh_token is required.");
  const { data } = await service
    .from("mcp_grants")
    .select("id, client_id, scope, refresh_expires_at, revoked_at")
    .eq("refresh_hash", sha256(p.refreshToken))
    .maybeSingle();
  const g = data as { id: string; client_id: string; scope: string; refresh_expires_at: string; revoked_at: string | null } | null;
  if (!g || g.revoked_at || new Date(g.refresh_expires_at).getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "The refresh token is invalid, expired or revoked.");
  }
  if (p.clientId && g.client_id !== p.clientId) throw new OAuthError("invalid_grant", "The refresh token was issued to another client.");
  const pair = freshPair();
  // Rotate: the old refresh token stops working the moment this succeeds.
  const upd = await service
    .from("mcp_grants")
    .update(pair.row)
    .eq("id", g.id)
    .eq("refresh_hash", sha256(p.refreshToken))
    .select("id")
    .maybeSingle();
  if (upd.error) throw new Error(`refreshGrant: ${upd.error.message}`);
  if (!upd.data) throw new OAuthError("invalid_grant", "The refresh token was already used.");
  return { access_token: pair.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: pair.refresh, scope: g.scope };
}

/** RFC 7009: revoke the grant behind an access or refresh token. Always succeeds from the caller's view. */
export async function revokeToken(service: SupabaseClient, token: string): Promise<void> {
  if (!token) return;
  const h = sha256(token);
  const now = new Date().toISOString();
  await service.from("mcp_grants").update({ revoked_at: now }).or(`access_hash.eq.${h},refresh_hash.eq.${h}`).is("revoked_at", null);
}

// ── Resource server ─────────────────────────────────────────────────

export interface McpUser {
  id: string;
  email: string;
  name: string;
  grantId: string;
  clientId: string;
  scope: string;
  expiresAt: number;
}

/** Resolve a bearer token to the person it was issued to, or null. */
export async function verifyAccessToken(service: SupabaseClient, token: string): Promise<McpUser | null> {
  if (!token.startsWith("cpa_")) return null;
  const { data } = await service
    .from("mcp_grants")
    .select("id, client_id, user_id, scope, access_expires_at, revoked_at, last_used_at, profile:profiles!mcp_grants_user_id_fkey ( email, name )")
    .eq("access_hash", sha256(token))
    .maybeSingle();
  const g = data as {
    id: string;
    client_id: string;
    user_id: string;
    scope: string;
    access_expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    profile: { email: string; name: string } | null;
  } | null;
  if (!g || g.revoked_at || !g.profile) return null;
  const expiresAt = new Date(g.access_expires_at).getTime();
  if (expiresAt < Date.now()) return null;
  // Someone who has left Clay (or changed domain) loses access with their next token check.
  if (!g.profile.email.toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return null;
  // Touch last_used_at at most every few minutes.
  if (!g.last_used_at || Date.now() - new Date(g.last_used_at).getTime() > 5 * 60 * 1000) {
    await service.from("mcp_grants").update({ last_used_at: new Date().toISOString() }).eq("id", g.id);
  }
  return {
    id: g.user_id,
    email: g.profile.email.toLowerCase(),
    name: g.profile.name,
    grantId: g.id,
    clientId: g.client_id,
    scope: g.scope,
    expiresAt: Math.floor(expiresAt / 1000),
  };
}
