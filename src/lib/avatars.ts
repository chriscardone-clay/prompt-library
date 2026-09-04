import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupSlackAvatar, slackConfigured } from "./slack";
import type { Profile } from "./types";

/** Re-check Slack this often so photo changes propagate. */
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

export function avatarIsStale(profile: Pick<Profile, "avatar_synced_at">): boolean {
  if (!slackConfigured()) return false;
  if (!profile.avatar_synced_at) return true;
  return Date.now() - new Date(profile.avatar_synced_at).getTime() > REFRESH_MS;
}

/**
 * Pull the person's photo from Slack and store it on their profile row.
 * Runs as the signed-in user (RLS lets you update only your own row).
 * Returns the profile with the fresh avatar, or the input untouched when
 * Slack couldn't be reached.
 */
export async function syncSlackAvatar(supabase: SupabaseClient, profile: Profile): Promise<Profile> {
  const url = await lookupSlackAvatar(profile.email);
  if (url === undefined) return profile;
  const next: Partial<Profile> = { avatar_synced_at: new Date().toISOString() };
  // A default Slack avatar isn't worth showing; keep whatever we had.
  if (url) next.avatar_url = url;
  const { error } = await supabase.from("profiles").update(next).eq("id", profile.id);
  if (error) {
    console.warn("[slack] could not store avatar", error.message);
    return profile;
  }
  return { ...profile, ...next };
}

/**
 * Right after the OAuth exchange: fetch the person's Slack photo so their
 * very first page already shows it. Never blocks sign-in on failure.
 */
export async function syncAvatarOnLogin(supabase: SupabaseClient, userId: string, email: string): Promise<void> {
  if (!slackConfigured()) return;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, name, avatar_url, avatar_synced_at")
      .eq("id", userId)
      .maybeSingle();
    const profile: Profile = (data as Profile | null) ?? {
      id: userId,
      email,
      name: email.split("@")[0],
      avatar_url: null,
      avatar_synced_at: null,
    };
    await syncSlackAvatar(supabase, profile);
  } catch (err) {
    console.warn("[slack] avatar sync on login failed", err instanceof Error ? err.message : err);
  }
}
