import "server-only";
import { cache } from "react";
import { SLACK_CHANNEL_ID } from "@/lib/constants";
import { isChannelMember, lookupSlackUserId, slackConfigured } from "@/lib/slack";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/** Re-check Slack membership this often. */
const RECHECK_MS = 24 * 60 * 60 * 1000;

interface Row {
  slack_user_id: string | null;
  slack_in_channel: boolean | null;
  slack_checked_at: string | null;
}

/**
 * Should we show this person the "join #auto-clayprompts" banner? True only
 * when Slack is configured and we positively know they're not in the channel.
 * Membership is cached on the profile and refreshed about daily.
 */
export const shouldNudgeToSlack = cache(async (user: Profile): Promise<boolean> => {
  // Local development aid: force the banner on without a Slack token.
  if (process.env.SLACK_NUDGE_FORCE === "1" && process.env.NODE_ENV !== "production") return true;
  if (!slackConfigured()) return false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("slack_user_id, slack_in_channel, slack_checked_at").eq("id", user.id).maybeSingle();
    const row = (data ?? null) as Row | null;
    const fresh = row?.slack_checked_at && Date.now() - new Date(row.slack_checked_at).getTime() < RECHECK_MS;
    if (fresh) return row?.slack_in_channel === false;

    const slackUserId = row?.slack_user_id ?? (await lookupSlackUserId(user.email));
    if (!slackUserId) return false; // not on Slack (or lookup failed): don't nag
    const member = await isChannelMember(SLACK_CHANNEL_ID, slackUserId);
    if (member === null) return false; // couldn't check (scope?); try again next time
    await supabase
      .from("profiles")
      .update({ slack_user_id: slackUserId, slack_in_channel: member, slack_checked_at: new Date().toISOString() })
      .eq("id", user.id);
    return !member;
  } catch (err) {
    console.warn("[slack] membership check failed", err instanceof Error ? err.message : err);
    return false;
  }
});
