-- Weekly Slack digest: settings, run log, catalog timestamps, and the query
-- that assembles a week's worth of activity in one round trip.

-- ── Catalog timestamps (needed to say "Monty was added this week") ────────
alter table public.apps     add column if not exists created_at timestamptz not null default now();
alter table public.surfaces add column if not exists created_at timestamptz not null default now();
alter table public.teams    add column if not exists created_at timestamptz not null default now();
-- Rows seeded before this migration predate the digest; don't report them as new.
update public.apps     set created_at = '2026-08-01T00:00:00Z' where created_at > '2026-09-06T00:00:00Z';
update public.surfaces set created_at = '2026-08-01T00:00:00Z' where created_at > '2026-09-06T00:00:00Z';
update public.teams    set created_at = '2026-08-01T00:00:00Z' where created_at > '2026-09-06T00:00:00Z';

-- ── Settings (single row) ───────────────────────────────────────────────
create table public.digest_settings (
  id            boolean primary key default true check (id),
  enabled       boolean not null default false,
  channel       text not null default '',          -- Slack channel ID (C…)
  editors_note  text not null default '',          -- one-off line for the next issue
  updated_at    timestamptz not null default now(),
  updated_by    text
);
insert into public.digest_settings (id) values (true);

-- ── Run log (idempotency + history) ─────────────────────────────────────
create table public.digest_runs (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,                        -- Monday (America/New_York) the issue covers
  kind        text not null check (kind in ('channel', 'resend', 'test')),
  channel     text not null,                        -- channel or DM id it went to
  slack_ts    text,                                 -- message ts, for chat.update later
  posted_at   timestamptz not null default now(),
  posted_by   text not null,                        -- 'cron' or an admin email
  stats       jsonb not null default '{}'::jsonb,
  payload     jsonb not null default '{}'::jsonb    -- the blocks that were sent
);
-- One real channel post per week. Resends and tests are exempt.
create unique index digest_runs_one_per_week on public.digest_runs (week_start) where kind = 'channel';
create index digest_runs_posted_at on public.digest_runs (posted_at desc);

alter table public.digest_settings enable row level security;
alter table public.digest_runs     enable row level security;
create policy digest_settings_admin on public.digest_settings for all using (public.is_admin()) with check (public.is_admin());
create policy digest_runs_admin     on public.digest_runs     for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.digest_settings, public.digest_runs to authenticated;

-- ── The week's activity, as one JSON document ───────────────────────────
-- Only public items are ever counted or named. Callable by admins (preview,
-- send now, test) and by the service role (the cron).
create or replace function public.weekly_digest(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'weekly_digest: admins only' using errcode = '42501';
  end if;

  with pub as (
    select p.* from public.prompts p where p.visibility = 'public'
  ),
  apps_of as (
    select pa.prompt_id,
           jsonb_agg(jsonb_build_object('app', pa.app, 'surfaces', coalesce(pa.surfaces, '{}'::text[])) order by pa.app) as apps
    from public.prompt_apps pa group by pa.prompt_id
  ),
  scored as (
    select p.id, p.title, p.description, p.kind::text as kind, p.created_at, p.updated_at, p.parent_id,
           pr.name as owner_name,
           coalesce(a.apps, '[]'::jsonb) as apps,
           (select count(*) from public.prompt_upvotes u where u.prompt_id = p.id and u.created_at >= p_from and u.created_at < p_to) as upvotes_week,
           (select count(*) from public.prompt_upvotes u where u.prompt_id = p.id) as upvotes_total,
           (select count(*) from pub c where c.parent_id = p.id and c.created_at >= p_from and c.created_at < p_to) as forks_week,
           (select count(*) from public.feedback f where f.prompt_id = p.id and f.created_at >= p_from and f.created_at < p_to) as feedback_week,
           (p.created_at >= p_from and p.created_at < p_to) as is_new
    from pub p
    left join public.profiles pr on pr.id = p.owner_id
    left join apps_of a on a.prompt_id = p.id
  ),
  ranked as (
    select s.*,
           3 * s.upvotes_week + 2 * s.forks_week + s.feedback_week + (case when s.is_new then 1 else 0 end) as score
    from scored s
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'stats', jsonb_build_object(
      'total',          (select count(*) from pub),
      'new',            (select count(*) from pub where created_at >= p_from and created_at < p_to),
      'upvotes',        (select count(*) from public.prompt_upvotes u join pub p on p.id = u.prompt_id where u.created_at >= p_from and u.created_at < p_to),
      'forks',          (select count(*) from pub where parent_id is not null and created_at >= p_from and created_at < p_to),
      'feedback',       (select count(*) from public.feedback f join pub p on p.id = f.prompt_id where f.created_at >= p_from and f.created_at < p_to),
      'resolved',       (select count(*) from public.feedback f join pub p on p.id = f.prompt_id where f.resolved and f.replied_at >= p_from and f.replied_at < p_to),
      'open_feedback',  (select count(*) from public.feedback f join pub p on p.id = f.prompt_id where not f.resolved)
    ),
    'top', (
      select coalesce(jsonb_agg(to_jsonb(r) - 'parent_id' - 'is_new'), '[]'::jsonb) from (
        select id, title, description, kind, owner_name, apps, upvotes_week, upvotes_total, forks_week, feedback_week, score
        from ranked where score > 0
        order by score desc, upvotes_total desc, updated_at desc
        limit 2
      ) r
    ),
    'new_items', (
      select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from (
        select r.id, r.title, r.kind, r.owner_name, r.apps, r.created_at,
               (select title from public.prompts x where x.id = r.parent_id) as parent_title
        from ranked r where r.is_new
        order by r.created_at desc
      ) n
    ),
    'updated', (
      select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from (
        select p.id, p.title, count(v.id) as versions,
               (select pr.name from public.prompt_versions v2 left join public.profiles pr on pr.id = v2.saved_by
                 where v2.prompt_id = p.id and v2.saved_at >= p_from and v2.saved_at < p_to order by v2.saved_at desc limit 1) as last_editor
        from pub p join public.prompt_versions v on v.prompt_id = p.id
        where v.saved_at >= p_from and v.saved_at < p_to
          and not (p.created_at >= p_from and p.created_at < p_to)
        group by p.id, p.title
        having count(v.id) >= 2
        order by count(v.id) desc, p.title
        limit 3
      ) u
    ),
    'open_feedback_items', (
      select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from (
        select p.id, p.title, count(*) as open_count
        from public.feedback f join pub p on p.id = f.prompt_id
        where not f.resolved
        group by p.id, p.title
        order by count(*) desc, max(f.created_at) desc
        limit 2
      ) o
    ),
    'catalog', jsonb_build_object(
      'apps',     (select coalesce(jsonb_agg(name order by created_at), '[]'::jsonb) from public.apps     where created_at >= p_from and created_at < p_to),
      'surfaces', (select coalesce(jsonb_agg(app || ' · ' || name order by created_at), '[]'::jsonb) from public.surfaces where created_at >= p_from and created_at < p_to),
      'teams',    (select coalesce(jsonb_agg(name order by created_at), '[]'::jsonb) from public.teams    where created_at >= p_from and created_at < p_to)
    )
  ) into v;

  return v;
end;
$$;

grant execute on function public.weekly_digest(timestamptz, timestamptz) to authenticated, service_role;
