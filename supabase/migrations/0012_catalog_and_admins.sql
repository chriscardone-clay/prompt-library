-- ═══════════════════════════════════════════════════════════════════
-- Managed catalog: apps, surfaces and teams become data instead of enums,
-- editable by admins from /admin. Renames cascade into existing prompts;
-- removals are refused while anything still uses the value (archive instead).
-- ═══════════════════════════════════════════════════════════════════

-- ── Admins ──────────────────────────────────────────────────────────
create table public.admins (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
insert into public.admins (email) values ('chris.cardone@clay.com');

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_allowed_user()
     and exists (select 1 from public.admins a where a.email = public.current_email())
$$;

-- ── Catalog tables ──────────────────────────────────────────────────
create table public.apps (
  name       text primary key check (length(btrim(name)) between 1 and 40),
  bg         text not null default '#F4F3F0' check (bg ~* '^#[0-9a-f]{6}$'),
  fg         text not null default '#1B1A18' check (fg ~* '^#[0-9a-f]{6}$'),
  install    text not null default '' check (length(install) <= 600),
  archived   boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.surfaces (
  app        text not null references public.apps (name) on update cascade on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  install    text not null default '' check (length(install) <= 600),
  position   integer not null default 0,
  primary key (app, name)
);

create table public.teams (
  name       text primary key check (length(btrim(name)) between 1 and 40),
  archived   boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

-- Seed with what the app has shipped with so far.
insert into public.apps (name, bg, fg, install, position) values
  ('Town',     '#F5F3FF', '#6D4CD6', 'Upload the files to the agent’s knowledge.', 1),
  ('Claude',   '#FFF3ED', '#B53D0A', 'Download the .skill file and upload it under Settings, Capabilities, Skills, or unzip it into ~/.claude/skills/ for Claude Code.', 2),
  ('ChatGPT',  '#FCFEE2', '#808000', 'Add the files to a project’s knowledge, or reference them from AGENTS.md for Codex.', 3),
  ('Claygent', '#F0FCFF', '#008BAD', 'Paste SKILL.md into the Claygent column prompt.', 4),
  ('Monty',    '#FFF0FA', '#CC089E', 'Upload the files to Monty’s knowledge.', 5),
  ('Granola',  '#FEFAE8', '#9E5802', 'Paste SKILL.md into a Granola recipe.', 6);

insert into public.surfaces (app, name, install, position) values
  ('Claude',  'Chat',   'Download the .skill file and upload it under Settings, Capabilities, Skills.', 1),
  ('Claude',  'Code',   'Copy the folder into ~/.claude/skills/ (or .claude/skills/ in your repo). Claude picks it up on the next session.', 2),
  ('Claude',  'Cowork', 'Download the .skill file and upload it under Settings, Capabilities, Skills.', 3),
  ('ChatGPT', 'Chat',   'Add SKILL.md and its files to a project or custom GPT’s knowledge.', 1),
  ('ChatGPT', 'Codex',  'Reference the files from your AGENTS.md so Codex reads them at the start of a task.', 2),
  ('ChatGPT', 'Work',   'Add SKILL.md and its files to the project’s files.', 3);

insert into public.teams (name, position) values ('EPD', 1), ('GS', 2), ('GTM', 3), ('Other', 4);

-- ── Enums → text, referencing the catalog ───────────────────────────
alter table public.prompt_apps
  alter column app type text using app::text;
alter table public.prompt_apps
  add constraint prompt_apps_app_fkey
  foreign key (app) references public.apps (name) on update cascade on delete restrict;

alter table public.prompts
  alter column audiences drop default,
  alter column audiences type text[] using audiences::text[],
  alter column audiences set default '{}'::text[];

drop type public.prompt_app;
drop type public.prompt_audience;

-- ── Integrity: surfaces and teams must exist in the catalog ─────────
create or replace function public.prompt_apps_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bad text;
begin
  new.surfaces := coalesce(new.surfaces, '{}');
  select s into bad
    from unnest(new.surfaces) as s
   where not exists (select 1 from public.surfaces sf where sf.app = new.app and sf.name = s)
   limit 1;
  if bad is not null then
    raise exception '"%" is not a surface of %.', bad, new.app;
  end if;
  return new;
end;
$$;
create trigger prompt_apps_validate
  before insert or update on public.prompt_apps
  for each row execute function public.prompt_apps_validate();

create or replace function public.prompts_validate_audiences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bad text;
begin
  select a into bad
    from unnest(new.audiences) as a
   where not exists (select 1 from public.teams t where t.name = a)
   limit 1;
  if bad is not null then
    raise exception '"%" is not a team.', bad;
  end if;
  return new;
end;
$$;
create trigger prompts_validate_audiences
  before insert or update of audiences on public.prompts
  for each row execute function public.prompts_validate_audiences();

-- ── Renames cascade into arrays; deletes are refused while in use ───
create or replace function public.surfaces_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.prompt_apps
       set surfaces = array_replace(surfaces, old.name, new.name)
     where app = new.app and old.name = any(surfaces);
  end if;
  return new;
end;
$$;
create trigger surfaces_after_update
  after update on public.surfaces
  for each row execute function public.surfaces_after_update();

create or replace function public.surfaces_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.prompt_apps where app = old.app and old.name = any(surfaces);
  if n > 0 then
    raise exception 'Surface "%" is used by % item(s). Remove it from them first.', old.name, n;
  end if;
  return old;
end;
$$;
create trigger surfaces_before_delete
  before delete on public.surfaces
  for each row execute function public.surfaces_before_delete();

create or replace function public.teams_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.prompts
       set audiences = array_replace(audiences, old.name, new.name)
     where old.name = any(audiences);
  end if;
  return new;
end;
$$;
create trigger teams_after_update
  after update on public.teams
  for each row execute function public.teams_after_update();

create or replace function public.teams_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.prompts where old.name = any(audiences);
  if n > 0 then
    raise exception 'Team "%" is used by % item(s). Archive it instead.', old.name, n;
  end if;
  return old;
end;
$$;
create trigger teams_before_delete
  before delete on public.teams
  for each row execute function public.teams_before_delete();

-- Apps: FK is on delete restrict; give a friendlier message.
create or replace function public.apps_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  select count(*) into n from public.prompt_apps where app = old.name;
  if n > 0 then
    raise exception 'App "%" is used by % item(s). Archive it instead.', old.name, n;
  end if;
  return old;
end;
$$;
create trigger apps_before_delete
  before delete on public.apps
  for each row execute function public.apps_before_delete();

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.admins   enable row level security;
alter table public.apps     enable row level security;
alter table public.surfaces enable row level security;
alter table public.teams    enable row level security;

create policy admins_select on public.admins for select using (public.is_admin());
create policy admins_write  on public.admins for all using (public.is_admin()) with check (public.is_admin());

create policy apps_select on public.apps for select using (public.is_allowed_user());
create policy apps_write  on public.apps for all using (public.is_admin()) with check (public.is_admin());

create policy surfaces_select on public.surfaces for select using (public.is_allowed_user());
create policy surfaces_write  on public.surfaces for all using (public.is_admin()) with check (public.is_admin());

create policy teams_select on public.teams for select using (public.is_allowed_user());
create policy teams_write  on public.teams for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.admins, public.apps, public.surfaces, public.teams to authenticated;
grant execute on function public.is_admin() to authenticated;
