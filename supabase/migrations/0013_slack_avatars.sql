-- Slack profile photos as avatars.
--
-- The app looks a user up in Slack by email (users.lookupByEmail) on sign-in
-- and every week thereafter, and stores the photo URL on their profile. Slack
-- is the canonical source, so the auth mirror trigger must stop overwriting a
-- stored avatar with whatever Google sends (usually nothing).

alter table public.profiles
  add column if not exists avatar_synced_at timestamptz;

comment on column public.profiles.avatar_synced_at is
  'When the avatar was last refreshed from Slack (null = never tried).';

create or replace function public.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text;
  v_avatar text;
begin
  v_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    initcap(replace(split_part(new.email, '@', 1), '.', ' '))
  );
  v_avatar := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );

  insert into public.profiles (id, email, name, avatar_url)
  values (new.id, lower(new.email), v_name, v_avatar)
  on conflict (id) do update
    set email      = excluded.email,
        name       = coalesce(excluded.name, public.profiles.name),
        -- Keep the avatar we already have (Slack wins); Google only fills a gap.
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();
  return new;
end;
$$;
