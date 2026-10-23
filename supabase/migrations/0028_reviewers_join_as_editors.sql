-- ═══════════════════════════════════════════════════════════════════
-- Enablement reviewers can add themselves as editors of any PUBLIC item,
-- so after a product update they can fix affected prompts themselves
-- instead of waiting on the owner. Private items stay owner-and-editors
-- only. Once added, they're ordinary editors: every edit rule applies, and
-- editing approved content still re-queues it for review.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.review_join_as_editor(p_prompt uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.prompts;
begin
  if not public.can_review() then
    raise exception 'Only Enablement reviewers can add themselves as editors.' using errcode = '42501';
  end if;
  select * into pr from public.prompts where id = p_prompt;
  if not found then
    raise exception 'No such item.' using errcode = '22023';
  end if;
  if pr.visibility <> 'public' then
    raise exception 'Only public items. Ask the owner to add you to a private one.' using errcode = '42501';
  end if;
  if public.can_edit_prompt(p_prompt) then
    return false; -- already the owner or an editor
  end if;
  insert into public.prompt_editors (prompt_id, email, added_by)
  values (p_prompt, public.current_email(), auth.uid());
  return true;
end;
$$;
revoke all on function public.review_join_as_editor(uuid) from public, anon;
grant execute on function public.review_join_as_editor(uuid) to authenticated;

-- connector_enablement from 0027, plus 'join_editor'.
create or replace function public.connector_enablement(p_actor uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  em text;
  rid uuid;
  a jsonb := coalesce(p_args, '{}'::jsonb);
  nm text;
  pos integer;
  joined boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'connector_enablement: service role only' using errcode = '42501';
  end if;
  select email into em from public.profiles where id = p_actor;
  if em is null then
    raise exception 'Unknown person.' using errcode = '22023';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'email', lower(em), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform set_config('request.jwt.claim.email', lower(em), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  case p_action
    when 'request' then
      rid := public.review_request((a ->> 'prompt')::uuid, nullif(a ->> 'use_case', '')::uuid, coalesce(a ->> 'note', ''));
    when 'withdraw' then
      perform public.review_withdraw((a ->> 'prompt')::uuid);
    when 'decide' then
      rid := public.review_decide(
        (a ->> 'prompt')::uuid, a ->> 'decision', nullif(a ->> 'tier', ''), nullif(a ->> 'use_case', '')::uuid,
        coalesce(a ->> 'note', ''), coalesce(a -> 'rubric', '{}'::jsonb), coalesce((a ->> 'due_days')::integer, 90));
    when 'revoke' then
      rid := public.review_revoke((a ->> 'prompt')::uuid, coalesce(a ->> 'note', ''));
    when 'set_gold' then
      perform public.review_set_gold((a ->> 'use_case')::uuid, nullif(a ->> 'prompt', '')::uuid);
    when 'set_outdated' then
      rid := public.review_set_outdated((a ->> 'prompt')::uuid, coalesce((a ->> 'outdated')::boolean, true), coalesce(a ->> 'note', ''));
    when 'join_editor' then
      joined := public.review_join_as_editor((a ->> 'prompt')::uuid);
      return jsonb_build_object('id', null, 'joined', joined);
    when 'create_use_case' then
      if not public.can_review() then
        raise exception 'Only Enablement reviewers can add use cases.' using errcode = '42501';
      end if;
      nm := regexp_replace(btrim(coalesce(a ->> 'name', '')), '\s+', ' ', 'g');
      if length(nm) not between 1 and 60 then
        raise exception 'Use case names are 1–60 characters.' using errcode = '22023';
      end if;
      if exists (select 1 from public.enablement_use_cases where lower(name) = lower(nm)) then
        raise exception '“%” already exists.', nm using errcode = '23505';
      end if;
      select coalesce(max(position), 0) + 1 into pos from public.enablement_use_cases;
      insert into public.enablement_use_cases (name, description, position)
      values (nm, left(btrim(coalesce(a ->> 'description', '')), 300), pos)
      returning id into rid;
    else
      raise exception 'Unknown action %', p_action using errcode = '22023';
  end case;
  return jsonb_build_object('id', rid);
end;
$$;
revoke all on function public.connector_enablement(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.connector_enablement(uuid, text, jsonb) to service_role;
