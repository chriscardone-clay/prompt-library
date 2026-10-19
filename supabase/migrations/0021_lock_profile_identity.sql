-- profiles.email is identity: editor invites link to it, the MCP connector
-- and Slack DMs trust it. Until now any signed-in person could rewrite their
-- own row's email (the update policy limits the row, not the columns), and
-- uniqueness was case-sensitive, so "VICTIM@clay.com" could sit next to
-- "victim@clay.com" and pass as that person. From here on only the auth
-- mirror trigger (handle_auth_user, security definer) sets email and name.

-- 1. Signed-in people may update only the columns the app writes for them:
--    the Slack photo sync and the Slack membership cache.
revoke update on public.profiles from authenticated;
grant update (avatar_url, avatar_synced_at, slack_user_id, slack_in_channel, slack_checked_at)
  on public.profiles to authenticated;

-- 2. Repair any row whose email no longer matches its auth account.
update public.profiles p
   set email = lower(u.email), updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.email is distinct from lower(u.email);

-- 3. One profile per address, whatever the case, and always stored lowercase.
alter table public.profiles
  add constraint profiles_email_lowercase check (email = lower(email));
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));

-- 4. Re-link every editor invite from the corrected emails. The before-write
--    trigger re-derives profile_id on update, so an invite that was bound to
--    whoever had claimed the address now points at its real owner (or stays
--    pending until they sign in).
update public.prompt_editors set email = email;
