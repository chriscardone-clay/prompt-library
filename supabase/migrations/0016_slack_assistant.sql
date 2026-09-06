-- Slack assistant: people @mention or DM the bot asking for a prompt or skill;
-- the app finds candidates in the library, asks Claude to pick, and replies.

-- Slack retries deliveries; remember what we've already handled.
create table public.slack_events (
  event_id    text primary key,
  received_at timestamptz not null default now()
);

-- What was asked and what we answered (admins can review it on /admin later).
create table public.agent_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null check (source in ('mention', 'dm', 'admin-test')),
  event_id    text,
  slack_user  text,
  channel     text,
  thread_ts   text,
  question    text not null,
  matched_ids uuid[] not null default '{}',
  reply       text,
  model       text,
  fallback    boolean not null default false,
  error       text
);
create index agent_requests_created_at on public.agent_requests (created_at desc);

alter table public.slack_events   enable row level security;
alter table public.agent_requests enable row level security;
-- Admins may read the log (and write test rows); everything else is service-role only.
create policy agent_requests_admin on public.agent_requests for all using (public.is_admin()) with check (public.is_admin());
grant select, insert on public.agent_requests to authenticated;

-- ── Full-text search over public items ──────────────────────────────────
-- Used to shortlist candidates when the library is large, and as the answer
-- when the model is unavailable. OR-semantics so natural-language questions
-- still hit something.
create index if not exists prompts_fts_idx on public.prompts using gin (
  to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(notes, '') || ' ' || left(coalesce(body, ''), 4000))
);

create or replace function public.search_public_prompts(q text, lim int default 40)
returns table (id uuid, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  terms text;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'search_public_prompts: admins only' using errcode = '42501';
  end if;
  select string_agg(w, ' | ')
    into terms
    from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(q, ''), '[^[:alnum:][:space:]]', ' ', 'g')), '\s+')) w
   where length(w) > 2;
  if terms is null or terms = '' then
    return;
  end if;
  return query
    select p.id,
           ts_rank_cd(
             to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p.notes, '') || ' ' || left(coalesce(p.body, ''), 4000)),
             to_tsquery('english', terms)
           ) as rank
      from public.prompts p
     where p.visibility = 'public'
       and to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.description, '') || ' ' || coalesce(p.notes, '') || ' ' || left(coalesce(p.body, ''), 4000))
           @@ to_tsquery('english', terms)
     order by rank desc, p.updated_at desc
     limit lim;
end;
$$;

grant execute on function public.search_public_prompts(text, int) to authenticated, service_role;
