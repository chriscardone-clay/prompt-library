-- ═══════════════════════════════════════════════════════════════════
-- Workflows: a third kind of library item (behind the WORKFLOWS_BETA flag).
--
-- A new enum value can't be used in the transaction that adds it, so the
-- columns and checks that mention 'workflow' live in 0022.
-- ═══════════════════════════════════════════════════════════════════

alter type public.prompt_kind add value if not exists 'workflow';
