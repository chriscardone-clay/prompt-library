-- ═══════════════════════════════════════════════════════════════════
-- Harden the identity helpers.
--
-- current_email() previously trusted only the `email` claim inside the JWT.
-- If a token is issued without that claim, every policy that depends on
-- is_allowed_user() evaluates false: selects silently return no rows and
-- inserts fail with "new row violates row-level security policy".
-- Now we fall back to the verified email stored on auth.users for the
-- signed-in user, so the check depends only on auth.uid().
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''),
    (select u.email from auth.users u where u.id = auth.uid()),
    ''
  ))
$$;

-- Keep the public grant explicit (security definer functions default to PUBLIC execute).
revoke all on function public.current_email() from public;
grant execute on function public.current_email() to authenticated, anon, service_role;

-- Re-assert the dependent helper unchanged so the planner picks up the new definition.
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
as $$
  select auth.uid() is not null
     and public.current_email() like ('%@' || public.allowed_email_domain())
$$;
