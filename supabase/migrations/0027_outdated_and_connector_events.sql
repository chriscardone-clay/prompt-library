-- ═══════════════════════════════════════════════════════════════════
-- 1. Outdated: Enablement can flag an item as out of date. Outdated items
--    rank below everything else and show a warning on their page. Flagging
--    takes away the gold standard; re-approving the item clears the flag.
-- 2. Enablement through the connector: one service-role entry point that
--    runs the review_* functions as the person behind the MCP token, so the
--    connector can never do more than that person could on the site.
-- 3. Connector events: one row per MCP tool call, for usage reporting
--    (which items get run, searches that found nothing, which clients).
-- ═══════════════════════════════════════════════════════════════════

-- ── Outdated ────────────────────────────────────────────────────────
alter table public.prompts
  add column if not exists outdated_at   timestamptz,
  add column if not exists outdated_by   uuid references public.profiles (id) on delete set null,
  add column if not exists outdated_note text not null default '' check (length(outdated_note) <= 2000);

-- History rows for flagging and clearing.
alter table public.prompt_reviews drop constraint if exists prompt_reviews_status_check;
alter table public.prompt_reviews add constraint prompt_reviews_status_check
  check (status in ('requested', 'approved', 'changes_requested', 'declined', 'withdrawn', 'revoked', 'outdated', 'outdated_cleared'));
alter table public.prompt_reviews drop constraint if exists prompt_reviews_reason_check;
alter table public.prompt_reviews add constraint prompt_reviews_reason_check
  check (reason in ('new', 're_review', 'due', 'revoked', 'outdated'));

-- The outdated columns only change through review_set_outdated. Approving
-- an item again (review_decide) clears them.
create or replace function public.prompts_outdated_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  privileged boolean := coalesce(current_setting('app.approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.outdated_at := null;
      new.outdated_by := null;
      new.outdated_note := '';
    end if;
    return new;
  end if;
  if not privileged then
    new.outdated_at := old.outdated_at;
    new.outdated_by := old.outdated_by;
    new.outdated_note := old.outdated_note;
  elsif new.approval <> 'none' and new.approved_at is distinct from old.approved_at then
    new.outdated_at := null;
    new.outdated_by := null;
    new.outdated_note := '';
  end if;
  if new.approval = 'gold' and new.outdated_at is not null then
    raise exception 'It''s flagged as outdated. Approve the current version (or clear the flag) before making it a gold standard.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists prompts_outdated_guard on public.prompts;
create trigger prompts_outdated_guard
  before insert or update on public.prompts
  for each row execute function public.prompts_outdated_guard();

create or replace function public.review_set_outdated(p_prompt uuid, p_outdated boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.prompts;
  rid uuid;
begin
  if not public.can_review() then
    raise exception 'Only Enablement reviewers can flag items as outdated.' using errcode = '42501';
  end if;
  select * into pr from public.prompts where id = p_prompt for update;
  if not found then
    raise exception 'No such item.' using errcode = '22023';
  end if;
  if p_outdated and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say what is out of date, so the owner knows what to fix.' using errcode = '22023';
  end if;
  if p_outdated = (pr.outdated_at is not null) then
    raise exception '%', case when p_outdated then 'It is already flagged as outdated.' else 'It is not flagged as outdated.' end using errcode = '22023';
  end if;

  insert into public.prompt_reviews (prompt_id, reason, status, use_case_id, reviewer_id, decision_note, decided_at)
  values (p_prompt, 'outdated', case when p_outdated then 'outdated' else 'outdated_cleared' end, pr.approval_use_case, auth.uid(), left(coalesce(p_note, ''), 2000), now())
  returning id into rid;

  perform set_config('app.approval', 'on', true);
  if p_outdated then
    update public.prompts
       set outdated_at = now(), outdated_by = auth.uid(), outdated_note = left(btrim(p_note), 2000),
           -- An outdated item can't be the gold standard; it stays approved underneath.
           approval = case when approval = 'gold' then 'approved' else approval end
     where id = p_prompt;
    update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt;
  else
    update public.prompts set outdated_at = null, outdated_by = null, outdated_note = '' where id = p_prompt;
  end if;
  return rid;
end;
$$;
revoke all on function public.review_set_outdated(uuid, boolean, text) from public, anon;
grant execute on function public.review_set_outdated(uuid, boolean, text) to authenticated;

-- ── Enablement through the connector ────────────────────────────────
-- The connector authenticates people with its own OAuth tokens and talks to
-- the database with the service role, where auth.uid() is null. This runs
-- one Enablement action with the JWT claims of p_actor for the rest of the
-- transaction, so can_review(), can_edit_prompt() and auth.uid() inside the
-- review_* functions see that person, and every rule applies unchanged.
create or replace function public.connector_enablement(p_actor uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  rid uuid;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  nm text;
  pos integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'connector_enablement: service role only' using errcode = '42501';
  end if;
  select email into em from public.profiles where id = p_actor;
  if em is null then
    raise exception 'Unknown person.' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'email', lower(em), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claim.email', lower(em), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  case p_action
    when 'request' then
      rid := public.review_request((a ->> 'prompt')::uuid, nullif(a ->> 'use_case', '')::uuid, coalesce(a ->> 'note', ''));
    when 'withdraw' then
      perform public.review_withdraw((a ->> 'prompt')::uuid);
    when 'decide' then
      rid := public.review_decide(
        (a ->> 'prompt')::uuid, a ->> 'decision', nullif(a ->> 'tier', ''), nullif(a ->> 'use_case', '')::uuid,
        coalesce(a ->> 'note', ''), coalesce(a -> 'rubric', '{}'::jsonb), coalesce((a ->> 'due_days')::integer, 90));
    when 'revoke' then
      rid := public.review_revoke((a ->> 'prompt')::uuid, coalesce(a ->> 'note', ''));
    when 'set_gold' then
      perform public.review_set_gold((a ->> 'use_case')::uuid, nullif(a ->> 'prompt', '')::uuid);
    when 'set_outdated' then
      rid := public.review_set_outdated((a ->> 'prompt')::uuid, coalesce((a ->> 'outdated')::boolean, true), coalesce(a ->> 'note', ''));
    when 'create_use_case' then
      if not public.can_review() then
        raise exception 'Only Enablement reviewers can add use cases.' using errcode = '42501';
      end if;
      nm := regexp_replace(btrim(coalesce(a ->> 'name', '')), '\s+', ' ', 'g');
      if length(nm) not between 1 and 60 then
        raise exception 'Use case names are 1–60 characters.' using errcode = '22023';
      end if;
      if exists (select 1 from public.enablement_use_cases where lower(name) = lower(nm)) then
        raise exception '“%” already exists.', nm using errcode = '23505';
      end if;
      select coalesce(max(position), 0) + 1 into pos from public.enablement_use_cases;
      insert into public.enablement_use_cases (name, description, position)
      values (nm, left(btrim(coalesce(a ->> 'description', '')), 300), pos)
      returning id into rid;
    else
      raise exception 'Unknown action %', p_action using errcode = '22023';
  end case;
  return jsonb_build_object('id', rid);
end;
$$;
revoke all on function public.connector_enablement(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.connector_enablement(uuid, text, jsonb) to service_role;

-- ── Connector events ────────────────────────────────────────────────
-- Written by the connector (service role) after each tool call. Never holds
-- fill-in values or the recommend_for_me profile: only which fill-ins were
-- given, and counts.
create table if not exists public.connector_events (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid references public.profiles (id) on delete set null,
  client_id    text,
  -- The connecting app as it registered itself (Claude, ChatGPT, Cursor…).
  client_name  text not null default '',
  tool         text not null,
  -- search · browse · view · run · install · recommend · improve · save · edit · review · report · other
  action       text not null check (action in ('search', 'browse', 'view', 'run', 'install', 'recommend', 'improve', 'save', 'edit', 'review', 'report', 'other')),
  prompt_id    uuid references public.prompts (id) on delete set null,
  query        text check (length(query) <= 500),
  filters      jsonb not null default '{}'::jsonb,
  -- Items shown, in order, so later runs can be traced back to a search.
  result_ids   uuid[] not null default '{}',
  result_count integer,
  -- ok · empty (nothing found) · needs_input (fill-ins missing) · denied · not_found · error
  outcome      text not null default 'ok' check (outcome in ('ok', 'empty', 'needs_input', 'denied', 'not_found', 'error')),
  detail       jsonb not null default '{}'::jsonb,
  duration_ms  integer
);
create index if not exists connector_events_created on public.connector_events (created_at desc);
create index if not exists connector_events_prompt on public.connector_events (prompt_id, created_at desc) where prompt_id is not null;
create index if not exists connector_events_user on public.connector_events (user_id, created_at desc);
create index if not exists connector_events_action on public.connector_events (action, created_at desc);

alter table public.connector_events enable row level security;
-- Admins and Enablement reviewers can read it for reporting; only the service role writes.
create policy connector_events_select on public.connector_events for select
  using (public.is_admin() or public.can_review());
grant select on public.connector_events to authenticated;

-- Per item: how it's used through the connector.
create or replace view public.connector_item_usage
with (security_invoker = true) as
select
  e.prompt_id,
  count(*) filter (where e.action = 'run' and e.outcome = 'ok')                                    as runs,
  count(*) filter (where e.action = 'view')                                                        as views,
  count(*) filter (where e.action = 'install')                                                     as installs,
  count(*) filter (where e.action = 'improve')                                                     as improves,
  count(distinct e.user_id) filter (where e.action in ('run', 'view', 'install') and e.outcome = 'ok') as people,
  count(*) filter (where e.action = 'run' and e.outcome = 'ok' and e.created_at > now() - interval '30 days') as runs_30d,
  max(e.created_at) filter (where e.action in ('run', 'view', 'install'))                         as last_used_at
from public.connector_events e
where e.prompt_id is not null
group by e.prompt_id;

-- Searches that found nothing: what people want that the library lacks.
create or replace view public.connector_search_gaps
with (security_invoker = true) as
select
  lower(btrim(e.query))            as query,
  count(*)                         as times,
  count(distinct e.user_id)        as people,
  max(e.created_at)                as last_searched_at
from public.connector_events e
where e.action = 'search' and e.outcome = 'empty' and coalesce(btrim(e.query), '') <> ''
group by lower(btrim(e.query));

grant select on public.connector_item_usage, public.connector_search_gaps to authenticated;

-- For the connector's top_items and usage_report tools (service role).
create or replace function public.connector_usage(p_since timestamptz)
returns table (prompt_id uuid, runs bigint, views bigint, installs bigint, people bigint, last_used_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select e.prompt_id,
         count(*) filter (where e.action = 'run'),
         count(*) filter (where e.action = 'view'),
         count(*) filter (where e.action = 'install'),
         count(distinct e.user_id),
         max(e.created_at)
    from public.connector_events e
   where e.prompt_id is not null
     and e.created_at >= p_since
     and e.action in ('run', 'view', 'install')
     and e.outcome = 'ok'
   group by e.prompt_id
$$;
revoke all on function public.connector_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.connector_usage(timestamptz) to service_role;
