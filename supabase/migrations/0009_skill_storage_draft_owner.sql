-- Tighten draft folders: before a prompt row exists, only the person who
-- started uploading into "<id>/…" may add to it (every object there must be
-- theirs). Once the row exists, editing rights on the prompt decide.
create or replace function public.can_write_skill_folder(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.storage_prompt_id(object_name) is not null
     and (
       case
         when exists (select 1 from public.prompts p where p.id = public.storage_prompt_id(object_name))
           then public.can_edit_prompt(public.storage_prompt_id(object_name))
         else not exists (
           select 1 from storage.objects o
            where o.bucket_id = 'skill-files'
              and o.name like public.storage_prompt_id(object_name)::text || '/%'
              and o.owner_id is distinct from auth.uid()::text
         )
       end
     )
$$;
