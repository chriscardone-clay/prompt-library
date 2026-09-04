-- ═══════════════════════════════════════════════════════════════════
-- Skills: a second kind of library item alongside prompts.
--
-- A skill is a small bundle of text files (SKILL.md + references) and/or
-- links to where it lives in its home app (a Claude project, a custom GPT,
-- a Town agent). Files and links are stored as JSON on the prompt row; the
-- SKILL.md content is mirrored into `body` so search and history keep
-- working unchanged. Versions snapshot files and links as well.
-- ═══════════════════════════════════════════════════════════════════

create type public.prompt_kind as enum ('prompt', 'skill');

alter table public.prompts
  add column if not exists kind  public.prompt_kind not null default 'prompt',
  add column if not exists files jsonb not null default '[]'::jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb;

-- A link-only skill has no SKILL.md, so the body may be empty for skills.
alter table public.prompts drop constraint if exists prompts_body_check;
alter table public.prompts add constraint prompts_body_check
  check (length(body) <= 50000 and (kind = 'skill' or length(btrim(body)) >= 1));
alter table public.prompts add constraint prompts_files_check
  check (jsonb_typeof(files) = 'array' and pg_column_size(files) <= 600000);
alter table public.prompts add constraint prompts_links_check
  check (jsonb_typeof(links) = 'array' and pg_column_size(links) <= 20000);

alter table public.prompt_versions
  add column if not exists files jsonb not null default '[]'::jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb;

-- Snapshot files/links too, and keep `kind` immutable.
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
                  or new.body is distinct from old.body
                  or new.files is distinct from old.files
                  or new.links is distinct from old.links;

  -- ownership / lineage / kind are immutable through the API
  new.owner_id   := old.owner_id;
  new.parent_id  := old.parent_id;
  new.created_at := old.created_at;
  new.kind       := old.kind;

  if content_changed then
    insert into public.prompt_versions (prompt_id, title, description, body, files, links, saved_at, saved_by)
    values (old.id, old.title, old.description, old.body, old.files, old.links, old.updated_at,
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
     set title = v.title, description = v.description, body = v.body,
         files = v.files, links = v.links
   where id = v.prompt_id;
  return v.prompt_id;
end;
$$;
