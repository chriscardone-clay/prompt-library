-- Ask AI conversations, so people can reopen and continue a chat. Each row is
-- one person's chat; turns are stored as JSON ({role, text, picks?, followUps?,
-- fallback?}). Only item ids are stored for picks: cards are rebuilt from what
-- the person can see when the chat is opened, so access changes still apply.
create table public.ai_chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text not null default '' check (length(title) <= 200),
  turns       jsonb not null default '[]'::jsonb check (jsonb_typeof(turns) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ai_chats_user on public.ai_chats (user_id, updated_at desc);

alter table public.ai_chats enable row level security;
-- Chats are yours alone.
create policy ai_chats_select on public.ai_chats
  for select using (public.is_allowed_user() and user_id = auth.uid());
create policy ai_chats_insert on public.ai_chats
  for insert with check (public.is_allowed_user() and user_id = auth.uid());
create policy ai_chats_update on public.ai_chats
  for update using (public.is_allowed_user() and user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_chats_delete on public.ai_chats
  for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.ai_chats to authenticated;
