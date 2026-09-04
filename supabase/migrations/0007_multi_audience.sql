-- A prompt or skill can be for several teams. Replace the single `audience`
-- with an `audiences` array (at least one), carrying existing values over.
alter table public.prompts
  add column if not exists audiences public.prompt_audience[] not null default '{}'::public.prompt_audience[];

update public.prompts set audiences = array[audience] where cardinality(audiences) = 0;

alter table public.prompts
  add constraint prompts_audiences_check check (cardinality(audiences) >= 1);

alter table public.prompts drop column audience;
