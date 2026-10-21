-- ═══════════════════════════════════════════════════════════════════
-- Workflows: reference architectures for Clay Workflows, saved as one
-- Markdown file that is stored and downloaded exactly as uploaded.
--
-- The .md lives in files[0] (a text SkillFile, never rewritten); `body`
-- mirrors its first 50,000 characters so search and history keep working,
-- the same way SKILL.md is mirrored for skills. A fork of a workflow is an
-- "adaptation"; its fork_note says what it was adapted for.
--
-- Additive only: existing prompts and skills are untouched, and the app
-- hides workflows from anyone outside WORKFLOWS_BETA.
-- ═══════════════════════════════════════════════════════════════════

alter table public.prompts
  add column if not exists workflow_trigger text not null default ''
    check (workflow_trigger in ('', 'webhook', 'schedule', 'table', 'manual', 'other')),
  add column if not exists workflow_stage text not null default ''
    check (workflow_stage in ('', 'draft', 'tested', 'production')),
  add column if not exists integrations text[] not null default '{}'
    check (cardinality(integrations) <= 20),
  add column if not exists customer_ready boolean not null default false;

-- A workflow always carries its .md as the first file.
alter table public.prompts drop constraint if exists prompts_workflow_doc_check;
alter table public.prompts add constraint prompts_workflow_doc_check
  check (
    kind <> 'workflow'
    or (
      jsonb_typeof(files -> 0) = 'object'
      and (files -> 0 ->> 'name') ~* '\.(md|markdown)$'
      and length(coalesce(files -> 0 ->> 'content', '')) > 0
    )
  );

-- Catalog entries the feature needs. Admins can rename, recolour or archive them.
insert into public.apps (name, bg, fg, install, position)
select 'Clay Workflows', '#F0F8FF', '#395AFA',
       'Rebuild it in Clay Workflows from the build recipe in the .md.',
       coalesce(max(position), 0) + 1
from public.apps
on conflict (name) do nothing;

insert into public.teams (name, position)
select 'Services', coalesce(max(position), 0) + 1
from public.teams
on conflict (name) do nothing;
