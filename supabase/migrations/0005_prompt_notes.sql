-- Optional "How to use" guidance shown under the prompt: when to use it, tips,
-- connectors it needs. Kept separate from `body` so the copyable prompt stays clean.
alter table public.prompts
  add column if not exists notes text not null default ''
  check (length(notes) <= 5000);
