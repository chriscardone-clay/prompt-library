-- ═══════════════════════════════════════════════════════════════════
-- Binary skill files (fonts, images…) live in a private Storage bucket.
-- Object paths are "<prompt id>/<file path>", so visibility follows the
-- prompt: readable by whoever can see the prompt, writable by whoever can
-- edit it (or by the uploader while the prompt is still a draft).
-- Text files stay inline in prompts.files; binary entries there hold the
-- storage path + size instead of content.
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('skill-files', 'skill-files', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

-- First path segment as a uuid, or null when it isn't one.
create or replace function public.storage_prompt_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  seg text := split_part(object_name, '/', 1);
begin
  if seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return seg::uuid;
  end if;
  return null;
end;
$$;

-- May the current user write into this prompt's folder? Yes while the
-- prompt doesn't exist yet (a draft being uploaded), or when they can edit it.
create or replace function public.can_write_skill_folder(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.storage_prompt_id(object_name) is not null
     and (
       not exists (select 1 from public.prompts p where p.id = public.storage_prompt_id(object_name))
       or public.can_edit_prompt(public.storage_prompt_id(object_name))
     )
$$;

drop policy if exists "skill files: read" on storage.objects;
create policy "skill files: read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'skill-files'
    and public.is_allowed_user()
    and (
      owner_id = auth.uid()::text
      or (public.storage_prompt_id(name) is not null and public.can_see_prompt(public.storage_prompt_id(name)))
    )
  );

drop policy if exists "skill files: insert" on storage.objects;
create policy "skill files: insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'skill-files'
    and public.is_allowed_user()
    and public.can_write_skill_folder(name)
  );

drop policy if exists "skill files: update" on storage.objects;
create policy "skill files: update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'skill-files'
    and public.is_allowed_user()
    and (owner_id = auth.uid()::text or public.can_write_skill_folder(name))
  );

drop policy if exists "skill files: delete" on storage.objects;
create policy "skill files: delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'skill-files'
    and public.is_allowed_user()
    and (owner_id = auth.uid()::text or public.can_write_skill_folder(name))
  );

-- Inline text can now be larger (binary is in storage); the manifest stays small.
alter table public.prompts drop constraint if exists prompts_files_check;
alter table public.prompts add constraint prompts_files_check
  check (jsonb_typeof(files) = 'array' and pg_column_size(files) <= 2500000);

grant execute on function public.storage_prompt_id(text), public.can_write_skill_folder(text) to authenticated;
