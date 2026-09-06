import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTHOR_HANDLE, AUTHOR_SLACK_URL } from "@/lib/constants";
import { getSiteUrl } from "@/lib/site";
import { buildDigestMessage } from "./blocks";
import type { DigestData, DigestMessage, DigestRun, DigestSettings } from "./types";
import { DIGEST_TZ, lastCompleteWeek, rangeLabel, type WeekWindow } from "./week";

export type WindowKind = "last" | "rolling";

/** "last" = the week Monday's cron would send; "rolling" = the past 7 days up to now. */
export function windowFor(kind: WindowKind, now = new Date()): WeekWindow {
  if (kind === "last") return lastCompleteWeek(now);
  const from = new Date(now.getTime() - 7 * 86400000);
  const week = lastCompleteWeek(now);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    weekStart: week.weekStart,
    label: `${rangeLabel(from, now, DIGEST_TZ)} (last 7 days)`,
  };
}

export interface Composed {
  window: WeekWindow;
  data: DigestData;
  message: DigestMessage;
}

/** Run the SQL rollup and turn it into blocks. Works with a user or service client. */
export async function composeDigest(client: SupabaseClient, window: WeekWindow, editorsNote: string): Promise<Composed> {
  const { data, error } = await client.rpc("weekly_digest", { p_from: window.from, p_to: window.to });
  if (error) throw new Error(`weekly_digest: ${error.message}`);
  const d = data as DigestData;
  const message = buildDigestMessage(d, {
    siteUrl: getSiteUrl(),
    label: window.label,
    editorsNote,
    authorHandle: AUTHOR_HANDLE,
    authorUrl: AUTHOR_SLACK_URL,
  });
  return { window, data: d, message };
}

export async function getDigestSettings(client: SupabaseClient): Promise<DigestSettings> {
  const { data, error } = await client.from("digest_settings").select("enabled, channel, editors_note, updated_at, updated_by").eq("id", true).single();
  if (error) throw new Error(`digest_settings: ${error.message}`);
  return data as DigestSettings;
}

export async function getDigestRuns(client: SupabaseClient, limit = 8): Promise<DigestRun[]> {
  const { data, error } = await client
    .from("digest_runs")
    .select("id, week_start, kind, channel, slack_ts, posted_at, posted_by, stats")
    .order("posted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`digest_runs: ${error.message}`);
  return (data ?? []) as DigestRun[];
}

export async function hasChannelRun(client: SupabaseClient, weekStart: string): Promise<boolean> {
  const { data } = await client.from("digest_runs").select("id").eq("week_start", weekStart).eq("kind", "channel").maybeSingle();
  return !!data;
}

export async function recordRun(
  client: SupabaseClient,
  run: { weekStart: string; kind: DigestRun["kind"]; channel: string; ts: string | null; postedBy: string; composed: Composed },
): Promise<void> {
  const { error } = await client.from("digest_runs").insert({
    week_start: run.weekStart,
    kind: run.kind,
    channel: run.channel,
    slack_ts: run.ts,
    posted_by: run.postedBy,
    stats: run.composed.data.stats,
    payload: { blocks: run.composed.message.blocks, text: run.composed.message.text, window: run.composed.window },
  });
  if (error) throw new Error(`digest_runs insert: ${error.message}`);
}

/** Slack's permalink shape for a message; good enough for the run history. */
export function slackPermalink(channel: string, ts: string | null): string | null {
  if (!ts) return null;
  return `https://clay-hq.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
}
