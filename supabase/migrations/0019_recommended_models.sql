-- Recommended / required model per app on a prompt or skill, plus a per-app
-- hint for the editor's model field (managed in /admin).

alter table public.prompt_apps
  add column if not exists model text not null default '',
  add column if not exists model_required boolean not null default false;

alter table public.apps
  add column if not exists model_hint text not null default '';

update public.apps set model_hint = 'e.g. Opus 4.6'            where name = 'Claude'   and model_hint = '';
update public.apps set model_hint = 'e.g. GPT-5 Thinking'      where name = 'ChatGPT'  and model_hint = '';
update public.apps set model_hint = 'e.g. Argon'               where name = 'Claygent' and model_hint = '';
update public.apps set model_hint = 'e.g. default agent model' where name = 'Town'     and model_hint = '';

-- A model that isn't set can't be required.
alter table public.prompt_apps
  drop constraint if exists prompt_apps_model_required_needs_model,
  add constraint prompt_apps_model_required_needs_model check (not model_required or model <> '');

-- Search: the model name is part of an item's metadata text.
create or replace function public.prompt_search_fields(p public.prompts, out t_title tsvector, out t_desc tsvector, out t_meta tsvector, out t_body tsvector)
language sql
stable
security definer
set search_path = public
as $$
  select to_tsvector('english', coalesce(p.title, '')),
         to_tsvector('english', coalesce(p.description, '')),
         to_tsvector('english', coalesce(p.notes, ''))
           || to_tsvector('simple',
                coalesce((select string_agg(pa.app || ' ' || array_to_string(coalesce(pa.surfaces, '{}'), ' ') || ' ' || coalesce(pa.model, ''), ' ')
                            from public.prompt_apps pa where pa.prompt_id = p.id), '')
                || ' ' || array_to_string(coalesce(p.audiences, '{}'), ' ')),
         to_tsvector('english', left(coalesce(p.body, ''), 8000));
$$;
