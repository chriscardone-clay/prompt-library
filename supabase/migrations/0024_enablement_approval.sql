-- ═══════════════════════════════════════════════════════════════════
-- Enablement Approved: Enablement reviews items, approves them (or makes
-- one the gold standard for a use case), and approved items rank higher in
-- Discover, search, the Claude connector and the Slack assistant.
--
-- Approval lives on the prompt (approval, approval_stale, …) for fast
-- ranking; every request and decision is a row in prompt_reviews. Approval
-- columns only change through the review_* functions below, which set
-- app.approval for the duration of their transaction.
-- ═══════════════════════════════════════════════════════════════════

-- ── Who reviews ─────────────────────────────────────────────────────
-- Managed by admins. Admins are not reviewers unless they're on the list.
create table if not exists public.enablement_reviewers (
  email      text primary key check (email = lower(email) and position('@' in email) > 1),
  added_by   text,
  created_at timestamptz not null default now()
);

create or replace function public.can_review()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_allowed_user()
     and exists (select 1 from public.enablement_reviewers r where r.email = public.current_email())
$$;
grant execute on function public.can_review() to authenticated;

alter table public.enablement_reviewers enable row level security;
create policy enablement_reviewers_select on public.enablement_reviewers for select
  using (public.is_admin() or public.can_review());
create policy enablement_reviewers_write on public.enablement_reviewers for all
  using (public.is_admin()) with check (public.is_admin());

-- ── Use cases (each can have one gold standard) ─────────────────────
create table if not exists public.enablement_use_cases (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 60),
  description    text not null default '' check (length(description) <= 300),
  gold_prompt_id uuid unique references public.prompts (id) on delete set null,
  position       integer not null default 0,
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);
create unique index if not exists enablement_use_cases_name_ci on public.enablement_use_cases (lower(name));

alter table public.enablement_use_cases enable row level security;
create policy enablement_use_cases_select on public.enablement_use_cases for select using (public.is_allowed_user());
create policy enablement_use_cases_write on public.enablement_use_cases for all
  using (public.can_review()) with check (public.can_review());

-- gold_prompt_id only moves through review_set_gold / review_decide.
create or replace function public.enablement_use_cases_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.approval', true), '') <> 'on' and auth.role() <> 'service_role' then
    if tg_op = 'INSERT' then
      new.gold_prompt_id := null;
    else
      new.gold_prompt_id := old.gold_prompt_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger enablement_use_cases_guard
  before insert or update on public.enablement_use_cases
  for each row execute function public.enablement_use_cases_guard();

-- ── Approval on the item ────────────────────────────────────────────
alter table public.prompts
  add column if not exists approval          text not null default 'none' check (approval in ('none', 'approved', 'gold')),
  add column if not exists approval_stale    boolean not null default false,
  add column if not exists approved_at       timestamptz,
  add column if not exists approved_by       uuid references public.profiles (id) on delete set null,
  add column if not exists approval_due_at   timestamptz,
  add column if not exists approval_use_case uuid references public.enablement_use_cases (id) on delete set null;

-- ── Requests and decisions ──────────────────────────────────────────
create table if not exists public.prompt_reviews (
  id            uuid primary key default gen_random_uuid(),
  prompt_id     uuid not null references public.prompts (id) on delete cascade,
  -- new: first review · re_review: changed after approval · due: periodic check · revoked: approval removed
  reason        text not null default 'new' check (reason in ('new', 're_review', 'due', 'revoked')),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'changes_requested', 'declined', 'withdrawn', 'revoked')),
  tier          text check (tier in ('approved', 'gold')),
  use_case_id   uuid references public.enablement_use_cases (id) on delete set null,
  requested_by  uuid references public.profiles (id) on delete set null,
  request_note  text not null default '' check (length(request_note) <= 2000),
  reviewer_id   uuid references public.profiles (id) on delete set null,
  decision_note text not null default '' check (length(decision_note) <= 2000),
  rubric        jsonb not null default '{}'::jsonb,
  -- The approved text, so a later re-review can show what changed.
  body_snapshot text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists prompt_reviews_prompt on public.prompt_reviews (prompt_id, created_at desc);
create unique index if not exists prompt_reviews_one_open on public.prompt_reviews (prompt_id) where status = 'requested';

alter table public.prompt_reviews enable row level security;
-- History is visible to anyone who can see the item. Writes go through the functions below.
create policy prompt_reviews_select on public.prompt_reviews for select
  using (public.can_review() or exists (select 1 from public.prompts p where p.id = prompt_reviews.prompt_id));

-- ── Guard + staleness on prompts ────────────────────────────────────
create or replace function public.prompts_approval_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  privileged boolean := coalesce(current_setting('app.approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not privileged then
      new.approval := 'none';
      new.approval_stale := false;
      new.approved_at := null;
      new.approved_by := null;
      new.approval_due_at := null;
      new.approval_use_case := null;
    end if;
    return new;
  end if;

  if not privileged then
    new.approval := old.approval;
    new.approval_stale := old.approval_stale;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
    new.approval_due_at := old.approval_due_at;
    new.approval_use_case := old.approval_use_case;
  end if;

  if new.approval <> 'none' then
    -- Approval covers the content that was reviewed: the prompt text, skill
    -- files or workflow .md. Title, description, notes and tags can change.
    if not privileged and (new.body is distinct from old.body or new.files is distinct from old.files) then
      new.approval_stale := true;
    end if;
    -- Only public items can be approved.
    if new.visibility = 'private' then
      new.approval := 'none';
      new.approval_stale := false;
      new.approval_due_at := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists prompts_approval_guard on public.prompts;
create trigger prompts_approval_guard
  before insert or update on public.prompts
  for each row execute function public.prompts_approval_guard();

create or replace function public.prompts_approval_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev text := coalesce(current_setting('app.approval', true), '');
begin
  -- An approved item that changed goes back in the queue on its own.
  if new.approval_stale and not old.approval_stale then
    insert into public.prompt_reviews (prompt_id, reason, use_case_id, requested_by, request_note)
    values (new.id, 're_review', new.approval_use_case, coalesce(auth.uid(), new.last_edited_by), 'Changed after it was approved.')
    on conflict (prompt_id) where status = 'requested' do nothing;
  end if;
  -- Losing approval also loses gold.
  if old.approval = 'gold' and new.approval <> 'gold' then
    perform set_config('app.approval', 'on', true);
    update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = new.id;
    perform set_config('app.approval', prev, true);
  end if;
  return new;
end;
$$;
drop trigger if exists prompts_approval_after on public.prompts;
create trigger prompts_approval_after
  after update on public.prompts
  for each row execute function public.prompts_approval_after();

-- ── Owner / editor actions ──────────────────────────────────────────
create or replace function public.review_request(p_prompt uuid, p_use_case uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.prompts;
  rid uuid;
begin
  if not public.is_allowed_user() or not public.can_edit_prompt(p_prompt) then
    raise exception 'Only the owner and editors can request a review.' using errcode = '42501';
  end if;
  select * into pr from public.prompts where id = p_prompt;
  if pr.visibility <> 'public' then
    raise exception 'Make it public before asking for a review.' using errcode = '22023';
  end if;
  if pr.approval <> 'none' and not pr.approval_stale then
    raise exception 'This version is already approved.' using errcode = '22023';
  end if;
  select id into rid from public.prompt_reviews where prompt_id = p_prompt and status = 'requested';
  if rid is not null then
    update public.prompt_reviews
       set use_case_id = coalesce(p_use_case, use_case_id),
           request_note = left(coalesce(p_note, ''), 2000),
           requested_by = auth.uid()
     where id = rid;
    return rid;
  end if;
  insert into public.prompt_reviews (prompt_id, reason, use_case_id, requested_by, request_note)
  values (p_prompt, case when pr.approval <> 'none' then 're_review' else 'new' end, p_use_case, auth.uid(), left(coalesce(p_note, ''), 2000))
  returning id into rid;
  return rid;
end;
$$;

create or replace function public.review_withdraw(p_prompt uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_allowed_user() or not public.can_edit_prompt(p_prompt) then
    raise exception 'Only the owner and editors can withdraw a request.' using errcode = '42501';
  end if;
  update public.prompt_reviews set status = 'withdrawn', decided_at = now()
   where prompt_id = p_prompt and status = 'requested';
end;
$$;

-- ── Reviewer actions ────────────────────────────────────────────────
-- Decide on an item: closes its open request (or records one, when
-- Enablement picks an item up on its own) and applies the outcome.
create or replace function public.review_decide(
  p_prompt uuid,
  p_decision text,          -- approved | changes_requested | declined
  p_tier text,              -- approved | gold (approved only)
  p_use_case uuid,
  p_note text,
  p_rubric jsonb,
  p_due_days integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.prompts;
  rid uuid;
  old_gold uuid;
  days integer := least(greatest(coalesce(p_due_days, 90), 7), 365);
begin
  if not public.can_review() then
    raise exception 'Only Enablement reviewers can decide.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'declined') then
    raise exception 'Unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'approved' and coalesce(p_tier, 'approved') not in ('approved', 'gold') then
    raise exception 'Unknown tier %', p_tier using errcode = '22023';
  end if;
  select * into pr from public.prompts where id = p_prompt for update;
  if not found then
    raise exception 'No such item.' using errcode = '22023';
  end if;
  if p_decision = 'approved' and pr.visibility <> 'public' then
    raise exception 'Only public items can be approved.' using errcode = '22023';
  end if;
  if p_decision = 'approved' and p_tier = 'gold' and p_use_case is null then
    raise exception 'Pick a use case for the gold standard.' using errcode = '22023';
  end if;

  select id into rid from public.prompt_reviews where prompt_id = p_prompt and status = 'requested';
  if rid is null then
    insert into public.prompt_reviews (prompt_id, reason, use_case_id, requested_by)
    values (p_prompt,
            case when pr.approval <> 'none' and pr.approval_due_at <= now() + interval '14 days' and not pr.approval_stale then 'due'
                 when pr.approval <> 'none' then 're_review' else 'new' end,
            p_use_case, auth.uid())
    returning id into rid;
  end if;

  update public.prompt_reviews
     set status = p_decision,
         tier = case when p_decision = 'approved' then coalesce(p_tier, 'approved') end,
         use_case_id = coalesce(p_use_case, use_case_id),
         reviewer_id = auth.uid(),
         decision_note = left(coalesce(p_note, ''), 2000),
         rubric = coalesce(p_rubric, '{}'::jsonb),
         body_snapshot = case when p_decision = 'approved' then pr.body end,
         decided_at = now()
   where id = rid;

  perform set_config('app.approval', 'on', true);

  if p_decision = 'approved' then
    update public.prompts
       set approval = coalesce(p_tier, 'approved'),
           approval_stale = false,
           approved_at = now(),
           approved_by = auth.uid(),
           approval_due_at = now() + make_interval(days => days),
           approval_use_case = coalesce(p_use_case, approval_use_case)
     where id = p_prompt;
    if p_tier = 'gold' then
      -- One gold standard per use case, and one use case per gold standard.
      update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt and id <> p_use_case;
      select gold_prompt_id into old_gold from public.enablement_use_cases where id = p_use_case;
      if old_gold is not null and old_gold <> p_prompt then
        update public.prompts set approval = 'approved' where id = old_gold and approval = 'gold';
      end if;
      update public.enablement_use_cases set gold_prompt_id = p_prompt where id = p_use_case;
    elsif pr.approval = 'gold' then
      update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt;
    end if;
  elsif p_decision = 'declined' and pr.approval <> 'none' then
    -- Declining a re-review removes the approval.
    update public.prompts
       set approval = 'none', approval_stale = false, approval_due_at = null
     where id = p_prompt;
    update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt;
  end if;
  return rid;
end;
$$;

-- Remove an approval outright.
create or replace function public.review_revoke(p_prompt uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if not public.can_review() then
    raise exception 'Only Enablement reviewers can remove an approval.' using errcode = '42501';
  end if;
  update public.prompt_reviews set status = 'withdrawn', decided_at = now()
   where prompt_id = p_prompt and status = 'requested';
  insert into public.prompt_reviews (prompt_id, reason, status, reviewer_id, decision_note, decided_at)
  values (p_prompt, 'revoked', 'revoked', auth.uid(), left(coalesce(p_note, ''), 2000), now())
  returning id into rid;
  perform set_config('app.approval', 'on', true);
  update public.prompts
     set approval = 'none', approval_stale = false, approval_due_at = null
   where id = p_prompt;
  update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt;
  return rid;
end;
$$;

-- Make an already-approved, unchanged item the gold standard for a use
-- case (or clear the use case's gold standard with p_prompt = null).
create or replace function public.review_set_gold(p_use_case uuid, p_prompt uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_gold uuid;
  pr public.prompts;
begin
  if not public.can_review() then
    raise exception 'Only Enablement reviewers can pick gold standards.' using errcode = '42501';
  end if;
  select gold_prompt_id into old_gold from public.enablement_use_cases where id = p_use_case for update;
  if not found then
    raise exception 'No such use case.' using errcode = '22023';
  end if;
  if p_prompt is not null then
    select * into pr from public.prompts where id = p_prompt;
    if not found or pr.approval = 'none' or pr.approval_stale or pr.visibility <> 'public' then
      raise exception 'Approve the current version first.' using errcode = '22023';
    end if;
  end if;
  perform set_config('app.approval', 'on', true);
  if old_gold is not null and old_gold is distinct from p_prompt then
    update public.prompts set approval = 'approved' where id = old_gold and approval = 'gold';
  end if;
  if p_prompt is not null then
    update public.enablement_use_cases set gold_prompt_id = null where gold_prompt_id = p_prompt and id <> p_use_case;
    update public.prompts set approval = 'gold', approval_use_case = p_use_case where id = p_prompt;
    insert into public.prompt_reviews (prompt_id, reason, status, tier, use_case_id, reviewer_id, decision_note, body_snapshot, decided_at)
    values (p_prompt, 'new', 'approved', 'gold', p_use_case, auth.uid(), 'Made the gold standard.', pr.body, now());
  end if;
  update public.enablement_use_cases set gold_prompt_id = p_prompt where id = p_use_case;
end;
$$;

revoke all on function public.review_request(uuid, uuid, text) from public, anon;
revoke all on function public.review_withdraw(uuid) from public, anon;
revoke all on function public.review_decide(uuid, text, text, uuid, text, jsonb, integer) from public, anon;
revoke all on function public.review_revoke(uuid, text) from public, anon;
revoke all on function public.review_set_gold(uuid, uuid) from public, anon;
grant execute on function public.review_request(uuid, uuid, text) to authenticated;
grant execute on function public.review_withdraw(uuid) to authenticated;
grant execute on function public.review_decide(uuid, text, text, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.review_revoke(uuid, text) to authenticated;
grant execute on function public.review_set_gold(uuid, uuid) to authenticated;
