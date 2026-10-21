-- ═══════════════════════════════════════════════════════════════════
-- Workflows, part 2: the Integrations catalog the Workflows team runs,
-- and publish links (read-only pages a customer opens without signing in).
-- ═══════════════════════════════════════════════════════════════════

-- ── Integrations catalog ────────────────────────────────────────────
-- Names the workflow editor offers. Workflows store names in
-- prompts.integrations (text[]); renames cascade, deletes are refused while
-- in use (archive instead), like teams.
create table if not exists public.integrations (
  name       text primary key check (length(btrim(name)) between 1 and 40),
  color      text not null default '#D1CDC7' check (color ~* '^#[0-9a-f]{6}$'),
  archived   boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists integrations_name_ci on public.integrations (lower(name));

-- People who may edit the catalog without being admins ("Workflow maintainers").
create table if not exists public.catalog_managers (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  scope      text not null default 'integrations' check (scope = 'integrations'),
  added_by   text,
  created_at timestamptz not null default now()
);

create or replace function public.can_manage_integrations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_allowed_user()
     and (
       public.is_admin()
       or exists (select 1 from public.catalog_managers m where m.email = public.current_email() and m.scope = 'integrations')
     )
$$;
grant execute on function public.can_manage_integrations() to authenticated;

alter table public.integrations enable row level security;
alter table public.catalog_managers enable row level security;

drop policy if exists integrations_select on public.integrations;
drop policy if exists integrations_write on public.integrations;
create policy integrations_select on public.integrations for select using (public.is_allowed_user());
create policy integrations_write on public.integrations for all
  using (public.can_manage_integrations()) with check (public.can_manage_integrations());

drop policy if exists catalog_managers_select on public.catalog_managers;
drop policy if exists catalog_managers_write on public.catalog_managers;
create policy catalog_managers_select on public.catalog_managers for select
  using (public.is_admin() or email = public.current_email());
create policy catalog_managers_write on public.catalog_managers for all
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.integrations_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.prompts
       set integrations = array_replace(integrations, old.name, new.name)
     where old.name = any(integrations);
  end if;
  return new;
end;
$$;
drop trigger if exists integrations_after_update on public.integrations;
create trigger integrations_after_update
  after update on public.integrations
  for each row execute function public.integrations_after_update();

create or replace function public.integrations_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.prompts where old.name = any(integrations);
  if n > 0 then
    raise exception 'Integration "%" is used by % workflow(s). Archive it instead.', old.name, n;
  end if;
  return old;
end;
$$;
drop trigger if exists integrations_before_delete on public.integrations;
create trigger integrations_before_delete
  before delete on public.integrations
  for each row execute function public.integrations_before_delete();

-- Starting list, then anything workflows already use.
insert into public.integrations (name, color, position) values
  ('Salesforce', '#429EFF', 1),
  ('HubSpot', '#FB4450', 2),
  ('Slack', '#FF70D2', 3),
  ('Snowflake', '#3BD3FD', 4),
  ('ZoomInfo', '#FF7714', 5),
  ('ZeroBounce', '#CBD810', 6),
  ('Clay tables', '#A17BF9', 7),
  ('Gong', '#6D4CD6', 8),
  ('Outreach', '#395AFA', 9),
  ('Marketo', '#CC089E', 10),
  ('BigQuery', '#008BAD', 11)
on conflict do nothing;

insert into public.integrations (name, position)
select distinct on (lower(i)) i, 100
  from public.prompts p, unnest(p.integrations) as i
 where length(btrim(i)) between 1 and 40
   and not exists (select 1 from public.integrations x where lower(x.name) = lower(i))
on conflict do nothing;

-- ── Publish links ───────────────────────────────────────────────────
-- A share is a snapshot of a customer-ready workflow taken at publish time:
-- the .md, the chosen attachments (copied to shares/<id>/ in storage), the
-- title and description. Later edits never reach a live link until someone
-- updates it. The public page reads only this table, never prompts.
--
-- The token is stored as is so owners and editors can copy the link again;
-- it grants exactly the snapshot stored beside it, so hashing it would add
-- no protection against someone who can already read this row.
create table if not exists public.workflow_shares (
  id                uuid primary key default gen_random_uuid(),
  prompt_id         uuid not null references public.prompts (id) on delete cascade,
  token             text not null unique check (length(token) >= 40),
  label             text not null default '' check (length(label) <= 120),
  title             text not null check (length(title) <= 200),
  description       text not null default '' check (length(description) <= 600),
  file              jsonb not null check (jsonb_typeof(file) = 'object'),
  attachments       jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  source_updated_at timestamptz not null,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  expires_at        timestamptz,
  revoked_at        timestamptz,
  view_count        integer not null default 0,
  last_viewed_at    timestamptz
);
create index if not exists workflow_shares_prompt_idx on public.workflow_shares (prompt_id, created_at desc);

alter table public.workflow_shares enable row level security;
-- Owners and editors can see their item's links. There are no write
-- policies: the app writes with the service role after checking edit rights,
-- and anonymous visitors never touch this table directly.
drop policy if exists workflow_shares_select on public.workflow_shares;
create policy workflow_shares_select on public.workflow_shares for select to authenticated
  using (public.is_allowed_user() and public.can_edit_prompt(prompt_id));

create or replace function public.record_share_view(p_share uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.workflow_shares
     set view_count = view_count + 1, last_viewed_at = now()
   where id = p_share;
$$;
revoke all on function public.record_share_view(uuid) from public, anon, authenticated;
grant execute on function public.record_share_view(uuid) to service_role;

-- Unticking customer-ready revokes every live link to the item.
create or replace function public.prompts_revoke_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.customer_ready and not new.customer_ready then
    update public.workflow_shares
       set revoked_at = now()
     where prompt_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists prompts_revoke_shares on public.prompts;
create trigger prompts_revoke_shares
  after update of customer_ready on public.prompts
  for each row execute function public.prompts_revoke_shares();
