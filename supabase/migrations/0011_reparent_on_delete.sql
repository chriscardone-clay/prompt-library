-- prompts_before_update pins parent_id (lineage is immutable through the API),
-- which also blocked delete_prompt's re-parenting and the FK's own "set null on
-- delete". Allow parent_id to change while a delete is in progress: the
-- transaction-local flag app.reparenting is set by delete_prompt and by the
-- owner cascade below.

create or replace function public.prompts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  content_changed boolean;
  reparenting boolean := coalesce(current_setting('app.reparenting', true), '') = 'on';
begin
  content_changed := new.title is distinct from old.title
                  or new.description is distinct from old.description
                  or new.body is distinct from old.body
                  or new.files is distinct from old.files
                  or new.links is distinct from old.links;

  -- ownership / lineage / kind are immutable through the API
  new.owner_id   := old.owner_id;
  if not reparenting then
    new.parent_id := old.parent_id;
  end if;
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

create or replace function public.delete_prompt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
begin
  if not public.is_allowed_user() then
    raise exception 'Not allowed';
  end if;
  select parent_id into v_parent from public.prompts where id = p_id and owner_id = auth.uid();
  if not found then
    raise exception 'Only the owner can delete this.';
  end if;

  perform set_config('app.reparenting', 'on', true);

  -- Re-parent forks (and keep their own fork notes when they have one).
  update public.prompts
     set parent_id = v_parent,
         fork_note = case when length(btrim(fork_note)) > 0 then fork_note else 'Original was deleted' end
   where parent_id = p_id;

  delete from public.prompts where id = p_id;
end;
$$;

-- When a prompt row is deleted by any other path (owner profile removed,
-- direct delete), release the lineage pin so the FK's "set null" can run.
create or replace function public.prompts_before_delete()
returns trigger
language plpgsql
as $$
begin
  perform set_config('app.reparenting', 'on', true);
  return old;
end;
$$;

drop trigger if exists prompts_before_delete on public.prompts;
create trigger prompts_before_delete
  before delete on public.prompts
  for each row execute function public.prompts_before_delete();
