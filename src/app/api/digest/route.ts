import { NextResponse, type NextRequest } from "next/server";
import { composeDigest, getDigestSettings, hasChannelRun, recordRun } from "@/lib/digest/run";
import { lastCompleteWeek } from "@/lib/digest/week";
import { postSlackMessage, slackErrorText } from "@/lib/slack";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Weekly digest cron. Vercel calls this on the schedule in vercel.json with
 * `Authorization: Bearer $CRON_SECRET`. Idempotent per week via digest_runs.
 *
 *   GET /api/digest          post last week's digest to the configured channel
 *   GET /api/digest?dry=1    return the blocks that would be posted, post nothing
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";

  const service = createServiceClient();
  const settings = await getDigestSettings(service);
  const window = lastCompleteWeek();

  if (!dry && !settings.enabled) {
    return NextResponse.json({ skipped: "disabled", week: window.weekStart });
  }
  if (!dry && (await hasChannelRun(service, window.weekStart))) {
    return NextResponse.json({ skipped: "already posted", week: window.weekStart });
  }

  const composed = await composeDigest(service, window, settings.editors_note);
  if (dry) {
    return NextResponse.json({
      window,
      enabled: settings.enabled,
      channel: settings.channel || null,
      stats: composed.data.stats,
      text: composed.message.text,
      blocks: composed.message.blocks,
    });
  }
  if (!settings.channel) {
    return NextResponse.json({ error: "No Slack channel configured. Set it on /admin." }, { status: 400 });
  }

  const posted = await postSlackMessage(settings.channel, composed.message);
  if (!posted.ok) {
    console.error("[digest] slack post failed", posted.error);
    return NextResponse.json({ error: slackErrorText(posted.error), code: posted.error }, { status: 502 });
  }
  await recordRun(service, { weekStart: window.weekStart, kind: "channel", channel: posted.channel, ts: posted.ts, postedBy: "cron", composed });
  // The editors' note is for one issue only.
  if (settings.editors_note) await service.from("digest_settings").update({ editors_note: "" }).eq("id", true);
  console.log("[digest] posted", { week: window.weekStart, channel: posted.channel, ts: posted.ts });
  return NextResponse.json({ posted: true, week: window.weekStart, channel: posted.channel, ts: posted.ts });
}
