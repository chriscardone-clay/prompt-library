-- Favorites (private per person) and a cache of Slack channel membership for
-- the "join #auto-clayprompts" banner.

create table public.prompt_favorites (
  prompt_id  uuid not null references public.prompts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prompt_id, user_id)
);
create index prompt_favorites_user on public.prompt_favorites (user_id, created_at desc);

alter table public.prompt_favorites enable row level security;
-- Favorites are yours alone: you see and manage only your own rows.
create policy favorites_select on public.prompt_favorites
  for select using (public.is_allowed_user() and user_id = auth.uid());
create policy favorites_insert on public.prompt_favorites
  for insert with check (public.is_allowed_user() and user_id = auth.uid() and public.can_see_prompt(prompt_id));
create policy favorites_delete on public.prompt_favorites
  for delete using (user_id = auth.uid());
grant select, insert, delete on public.prompt_favorites to authenticated;

-- Slack membership cache, refreshed by the app about once a day per person.
alter table public.profiles
  add column if not exists slack_user_id text,
  add column if not exists slack_in_channel boolean,
  add column if not exists slack_checked_at timestamptz;
