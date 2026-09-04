-- Add Monty as a tool a prompt can be built for.
-- (Adding an enum value is not transactional in Postgres; do not use the new
--  value in this same migration.)
alter type public.prompt_app add value if not exists 'Monty';
