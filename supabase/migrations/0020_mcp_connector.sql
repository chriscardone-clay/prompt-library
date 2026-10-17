-- MCP connector: people connect Claude (claude.ai, Claude Desktop, Claude Code)
-- to the library at /api/mcp. The app is its own small OAuth 2.1 authorization
-- server: clients register themselves (RFC 7591), the person approves on
-- /oauth/authorize while signed in with their clay.com Google account, and the
-- client exchanges the code (PKCE, S256 only) for an access + refresh token.
--
-- Codes and tokens are stored as SHA-256 hashes, never in the clear. All
-- writes go through the service role from the app's route handlers; signed-in
-- people may only see and revoke their own grants (the "Connect to Claude"
-- page lists them).

create table public.mcp_clients (
  client_id      text primary key,
  client_name    text not null default '' check (length(client_name) <= 200),
  redirect_uris  text[] not null check (coalesce(array_length(redirect_uris, 1), 0) between 1 and 10),
  created_at     timestamptz not null default now()
);

create table public.mcp_auth_codes (
  code_hash       text primary key,
  client_id       text not null references public.mcp_clients (client_id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  redirect_uri    text not null,
  code_challenge  text not null,
  scope           text not null default '',
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index mcp_auth_codes_expires on public.mcp_auth_codes (expires_at);

-- One row per grant (a person approving a client once). Refreshing rotates
-- both hashes in place, so the person sees one "connected app" per approval.
create table public.mcp_grants (
  id                  uuid primary key default gen_random_uuid(),
  client_id           text not null references public.mcp_clients (client_id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  scope               text not null default '',
  access_hash         text not null unique,
  access_expires_at   timestamptz not null,
  refresh_hash        text not null unique,
  refresh_expires_at  timestamptz not null,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz
);
create index mcp_grants_user on public.mcp_grants (user_id, created_at desc);

alter table public.mcp_clients    enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_grants     enable row level security;

-- Client names show on the connected-apps list; registration data is not secret.
create policy mcp_clients_select on public.mcp_clients
  for select using (public.is_allowed_user());
-- Your own grants: list them and revoke them (an update that sets revoked_at).
create policy mcp_grants_select on public.mcp_grants
  for select using (public.is_allowed_user() and user_id = auth.uid());
create policy mcp_grants_revoke on public.mcp_grants
  for update using (public.is_allowed_user() and user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.mcp_clients to authenticated;
grant select (id, client_id, user_id, scope, created_at, last_used_at, revoked_at) on public.mcp_grants to authenticated;
grant update (revoked_at) on public.mcp_grants to authenticated;
