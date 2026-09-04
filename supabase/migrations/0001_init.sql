-- ═══════════════════════════════════════════════════════════════════
-- Clay Prompt Library — initial schema
--
-- Tables:   profiles, prompts, prompt_apps, prompt_editors, prompt_upvotes,
--           prompt_versions, feedback
-- Rules:    only @clay.com (see allowed_email_domain()) accounts may sign in;
--           public prompts are visible to everyone at Clay, private prompts
--           only to their owner + editors; owner + editors can edit and
--           resolve feedback; anyone can fork, upvote and leave feedback.
-- Versions: every content change (title/description/body) snapshots the
--           previous version automatically (trigger).
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────
create type public.prompt_app as enum ('Town', 'Claude', 'ChatGPT', 'Claygent');
create type public.prompt_audience as enum ('EPD', 'GS', 'GTM', 'Other');
create type public.prompt_visibility as enum ('public', 'private');

-- ── Helpers ─────────────────────────────────────────────────────────
create or replace function public.allowed_email_domain()
returns text
language sql
immutable
as $$ select 'clay.com'::text $$;

create or replace function public.current_email()
returns text
language sql
stable
as $$
  select lower(coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    ''
  ))
$$;

create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null
     and public.current_email() like '%@' || public.allowed_email_domain()
$$;

-- ── Profiles ────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  name        text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

-- Reject sign-ups from outside the allowed domain at the auth layer.
create or replace function public.enforce_allowed_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) not like '%@' || public.allowed_email_domain() then
    raise exception 'Only @% accounts can sign in.', public.allowed_email_domain()
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowed_domain on auth.users;
create trigger enforce_allowed_domain
  before insert on auth.users
  for each row execute function public.enforce_allowed_domain();

-- Mirror auth.users into profiles.
create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_avatar text;
begin
  v_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    initcap(replace(split_part(new.email, '@', 1), '.', ' '))
  );
  v_avatar := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );

  insert into public.profiles (id, email, name, avatar_url)
  values (new.id, lower(new.email), v_name, v_avatar)
  on conflict (id) do update
    set email      = excluded.email,
        name       = coalesce(excluded.name, public.profiles.name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user();

-- ── Prompts ─────────────────────────────────────────────────────────
create table public.prompts (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text not null default '' check (length(description) <= 600),
  body            text not null check (length(btrim(body)) between 1 and 50000),
  audience        public.prompt_audience not null default 'GTM',
  visibility      public.prompt_visibility not null default 'public',
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  parent_id       uuid references public.prompts (id) on delete set null,
  fork_note       text not null default '' check (length(fork_note) <= 600),
  last_edited_by  uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index prompts_owner_idx   on public.prompts (owner_id);
create index prompts_parent_idx  on public.prompts (parent_id);
create index prompts_updated_idx on public.prompts (updated_at desc);

-- Which tools a prompt is built for. `surfaces` is empty for "any surface".
create table public.prompt_apps (
  prompt_id  uuid not null references public.prompts (id) on delete cascade,
  app        public.prompt_app not null,
  surfaces   text[] not null default '{}',
  primary key (prompt_id, app)
);

-- Editors are keyed by email so an owner can invite a teammate who hasn't
-- signed in yet. `profile_id` is filled in once that person has a profile.
create table public.prompt_editors (
  prompt_id   uuid not null references public.prompts (id) on delete cascade,
  email       text not null,
  profile_id  uuid references public.profiles (id) on delete cascade,
  added_by    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (prompt_id, email),
  constraint prompt_editors_email_lower check (email = lower(email))
);
create index prompt_editors_email_idx on public.prompt_editors (email);

create table public.prompt_upvotes (
  prompt_id   uuid not null references public.prompts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (prompt_id, user_id)
);

create table public.prompt_versions (
  id           uuid primary key default gen_random_uuid(),
  prompt_id    uuid not null references public.prompts (id) on delete cascade,
  title        text not null,
  description  text not null default '',
  body         text not null,
  saved_at     timestamptz not null default now(),
  saved_by     uuid references public.profiles (id) on delete set null
);
create index prompt_versions_prompt_idx on public.prompt_versions (prompt_id, saved_at);

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  prompt_id   uuid not null references public.prompts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  text        text not null check (length(btrim(text)) between 1 and 4000),
  resolved    boolean not null default false,
  reply       text not null default '' check (length(reply) <= 4000),
  reply_by    uuid references public.profiles (id) on delete set null,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index feedback_prompt_idx on public.feedback (prompt_id, created_at desc);

-- ── Access helpers (security definer so RLS policies don't recurse) ──
create or replace function public.is_prompt_owner(p_prompt uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.prompts p
    where p.id = p_prompt and p.owner_id = auth.uid()
  )
$$;

create or replace function public.can_edit_prompt(p_prompt uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_prompt_owner(p_prompt)
      or exists (
        select 1 from public.prompt_editors e
        where e.prompt_id = p_prompt
          and (e.profile_id = auth.uid() or e.email = public.current_email())
      )
$$;

create or replace function public.can_see_prompt(p_prompt uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.prompts p
    where p.id = p_prompt and p.visibility = 'public'
  ) or public.can_edit_prompt(p_prompt)
$$;

-- ── Triggers ────────────────────────────────────────────────────────

-- Snapshot the previous version whenever the content changes.
create or replace function public.prompts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  content_changed boolean;
begin
  content_changed := new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.body is distinct from old.body;

  -- ownership / lineage are immutable through the API
  new.owner_id   := old.owner_id;
  new.parent_id  := old.parent_id;
  new.created_at := old.created_at;

  if content_changed then
    insert into public.prompt_versions (prompt_id, title, description, body, saved_at, saved_by)
    values (old.id, old.title, old.description, old.body, old.updated_at,
            coalesce(old.last_edited_by, old.owner_id));
    new.last_edited_by := coalesce(auth.uid(), old.last_edited_by);
    new.updated_at := now();
  else
    new.last_edited_by := old.last_edited_by;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger prompts_before_update
  before update on public.prompts
  for each row execute function public.prompts_before_update();

create or replace function public.prompts_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.owner_id       := coalesce(new.owner_id, auth.uid());
  new.last_edited_by := coalesce(new.last_edited_by, new.owner_id);
  new.created_at     := coalesce(new.created_at, now());
  new.updated_at     := coalesce(new.updated_at, new.created_at);
  return new;
end;
$$;

create trigger prompts_before_insert
  before insert on public.prompts
  for each row execute function public.prompts_before_insert();

-- Normalise editor emails and link to a profile if one exists.
create or replace function public.prompt_editors_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.email := lower(btrim(new.email));
  if new.email not like '%@' || public.allowed_email_domain() then
    raise exception 'Editors must have an @% address.', public.allowed_email_domain();
  end if;
  select id into new.profile_id from public.profiles where lower(email) = new.email;
  if tg_op = 'INSERT' then
    new.added_by := coalesce(new.added_by, auth.uid());
  end if;
  return new;
end;
$$;

create trigger prompt_editors_before_write
  before insert or update on public.prompt_editors
  for each row execute function public.prompt_editors_before_write();

-- When someone signs in for the first time, attach their pending invites.
create or replace function public.link_editor_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.prompt_editors
     set profile_id = new.id
   where email = lower(new.email) and profile_id is null;
  return new;
end;
$$;

create trigger link_editor_invites
  after insert on public.profiles
  for each row execute function public.link_editor_invites();

-- Reply / resolve bookkeeping.
create or replace function public.feedback_before_update()
returns trigger
language plpgsql
as $$
begin
  new.prompt_id  := old.prompt_id;
  new.user_id    := old.user_id;
  new.text       := old.text;
  new.created_at := old.created_at;
  if new.reply is distinct from old.reply and length(btrim(new.reply)) > 0 then
    new.reply_by   := coalesce(auth.uid(), new.reply_by);
    new.replied_at := now();
  end if;
  return new;
end;
$$;

create trigger feedback_before_update
  before update on public.feedback
  for each row execute function public.feedback_before_update();

create or replace function public.feedback_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.user_id  := coalesce(new.user_id, auth.uid());
  new.resolved := false;
  new.reply    := '';
  new.reply_by := null;
  return new;
end;
$$;

create trigger feedback_before_insert
  before insert on public.feedback
  for each row execute function public.feedback_before_insert();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.profiles        enable row level security;
alter table public.prompts         enable row level security;
alter table public.prompt_apps     enable row level security;
alter table public.prompt_editors  enable row level security;
alter table public.prompt_upvotes  enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.feedback        enable row level security;

-- profiles: everyone at Clay can see names + avatars; you edit only yours.
create policy profiles_select on public.profiles
  for select using (public.is_allowed_user());
create policy profiles_update on public.profiles
  for update using (public.is_allowed_user() and id = auth.uid())
  with check (id = auth.uid());

-- prompts
create policy prompts_select on public.prompts
  for select using (
    public.is_allowed_user()
    and (visibility = 'public' or public.can_edit_prompt(id))
  );
create policy prompts_insert on public.prompts
  for insert with check (
    public.is_allowed_user()
    and owner_id = auth.uid()
    and (parent_id is null or public.can_see_prompt(parent_id))
  );
create policy prompts_update on public.prompts
  for update using (public.is_allowed_user() and public.can_edit_prompt(id))
  with check (public.can_edit_prompt(id));
create policy prompts_delete on public.prompts
  for delete using (public.is_allowed_user() and owner_id = auth.uid());

-- prompt_apps follow the prompt
create policy prompt_apps_select on public.prompt_apps
  for select using (public.is_allowed_user() and public.can_see_prompt(prompt_id));
create policy prompt_apps_write on public.prompt_apps
  for all using (public.is_allowed_user() and public.can_edit_prompt(prompt_id))
  with check (public.can_edit_prompt(prompt_id));

-- prompt_editors: visible with the prompt; owner + editors may add, owner may remove
create policy prompt_editors_select on public.prompt_editors
  for select using (public.is_allowed_user() and public.can_see_prompt(prompt_id));
create policy prompt_editors_insert on public.prompt_editors
  for insert with check (public.is_allowed_user() and public.can_edit_prompt(prompt_id));
create policy prompt_editors_delete on public.prompt_editors
  for delete using (
    public.is_allowed_user()
    and (public.is_prompt_owner(prompt_id) or email = public.current_email())
  );

-- upvotes: anyone who can see the prompt; you manage only your own vote
create policy prompt_upvotes_select on public.prompt_upvotes
  for select using (public.is_allowed_user() and public.can_see_prompt(prompt_id));
create policy prompt_upvotes_insert on public.prompt_upvotes
  for insert with check (
    public.is_allowed_user() and user_id = auth.uid() and public.can_see_prompt(prompt_id)
  );
create policy prompt_upvotes_delete on public.prompt_upvotes
  for delete using (public.is_allowed_user() and user_id = auth.uid());

-- versions: history is for owner + editors only. Rows are written by trigger.
create policy prompt_versions_select on public.prompt_versions
  for select using (public.is_allowed_user() and public.can_edit_prompt(prompt_id));

-- feedback: read with the prompt; post as yourself; owner/editors reply + resolve;
-- authors may delete their own note.
create policy feedback_select on public.feedback
  for select using (public.is_allowed_user() and public.can_see_prompt(prompt_id));
create policy feedback_insert on public.feedback
  for insert with check (
    public.is_allowed_user() and user_id = auth.uid() and public.can_see_prompt(prompt_id)
  );
create policy feedback_update on public.feedback
  for update using (public.is_allowed_user() and public.can_edit_prompt(prompt_id))
  with check (public.can_edit_prompt(prompt_id));
create policy feedback_delete on public.feedback
  for delete using (public.is_allowed_user() and user_id = auth.uid());

-- ── RPC: restore a version (one transaction, RLS-checked) ───────────
create or replace function public.restore_prompt_version(p_version uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v record;
begin
  select * into v from public.prompt_versions where id = p_version;
  if not found then
    raise exception 'Version not found';
  end if;
  update public.prompts
     set title = v.title, description = v.description, body = v.body
   where id = v.prompt_id;
  return v.prompt_id;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
