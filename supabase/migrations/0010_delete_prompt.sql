-- Owner-initiated delete that keeps the fork tree intact: forks of the
-- deleted item move up to its parent and note that the original is gone.
-- Runs as definer because the owner usually can't edit other people's forks.
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

  -- Re-parent forks (and keep their own fork notes when they have one).
  update public.prompts
     set parent_id = v_parent,
         fork_note = case when length(btrim(fork_note)) > 0 then fork_note else 'Original was deleted' end
   where parent_id = p_id;

  delete from public.prompts where id = p_id;
end;
$$;

revoke all on function public.delete_prompt(uuid) from public;
grant execute on function public.delete_prompt(uuid) to authenticated;
