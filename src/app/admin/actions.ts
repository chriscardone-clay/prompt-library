"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/app/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { isAdmin } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { handleAsk } from "@/lib/agent/handle";
import { composeDigest, getDigestSettings, hasChannelRun, recordRun, windowFor, type WindowKind } from "@/lib/digest/run";
import { openSlackDm, postSlackMessage, slackConfigured, slackErrorText } from "@/lib/slack";

const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 40;
const INSTALL_MAX = 600;

async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  if (!(await isAdmin())) return { supabase, error: "Admins only." as const };
  return { supabase, error: null };
}

/** The catalog feeds every page, so bust everything. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s && s.length <= NAME_MAX ? s : null;
}

// ── Apps ────────────────────────────────────────────────────────────
export interface AppInput {
  /** Existing name when editing (rename cascades into items). */
  originalName?: string;
  name: string;
  bg: string;
  fg: string;
  install: string;
  archived: boolean;
}

export async function saveApp(input: AppInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `App name must be 1–${NAME_MAX} characters.` };
  if (!HEX.test(input.bg) || !HEX.test(input.fg)) return { ok: false, error: "Colours must be hex like #FFF3ED." };
  const install = String(input.install ?? "").trim().slice(0, INSTALL_MAX);
  const row = { name, bg: input.bg.toUpperCase(), fg: input.fg.toUpperCase(), install, archived: !!input.archived };

  if (input.originalName && input.originalName !== name) {
    const { error: e } = await supabase.from("apps").update(row).eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else if (input.originalName) {
    const { error: e } = await supabase.from("apps").update(row).eq("name", name);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase.from("apps").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { error: e } = await supabase.from("apps").insert({ ...row, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `An app called ${name} already exists.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteApp(name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("apps").delete().eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Surfaces ────────────────────────────────────────────────────────
export interface SurfaceInput {
  app: string;
  originalName?: string;
  name: string;
  install: string;
}

export async function saveSurface(input: SurfaceInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `Surface name must be 1–${NAME_MAX} characters.` };
  const install = String(input.install ?? "").trim().slice(0, INSTALL_MAX);
  if (input.originalName) {
    const { error: e } = await supabase
      .from("surfaces")
      .update({ name, install })
      .eq("app", input.app)
      .eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase
      .from("surfaces")
      .select("position")
      .eq("app", input.app)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: e } = await supabase
      .from("surfaces")
      .insert({ app: input.app, name, install, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `${input.app} already has a surface called ${name}.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteSurface(app: string, name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("surfaces").delete().eq("app", app).eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Teams ───────────────────────────────────────────────────────────
export interface TeamInput {
  originalName?: string;
  name: string;
  archived: boolean;
}

export async function saveTeam(input: TeamInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `Team name must be 1–${NAME_MAX} characters.` };
  const row = { name, archived: !!input.archived };
  if (input.originalName) {
    const { error: e } = await supabase.from("teams").update(row).eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase.from("teams").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { error: e } = await supabase.from("teams").insert({ ...row, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `A team called ${name} already exists.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteTeam(name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("teams").delete().eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Ordering ────────────────────────────────────────────────────────
/** Persist a new order: position = index. For surfaces, `scope` is the app name. */
export async function reorder(kind: "apps" | "teams" | "surfaces", names: string[], scope?: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  for (let i = 0; i < names.length; i++) {
    let q = supabase.from(kind).update({ position: i + 1 }).eq("name", names[i]);
    if (kind === "surfaces") q = q.eq("app", scope ?? "");
    const { error: e } = await q;
    if (e) return { ok: false, error: e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Admins ──────────────────────────────────────────────────────────
export async function addAdmin(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const e = email.trim().toLowerCase();
  if (!e.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return { ok: false, error: `Admins need an @${ALLOWED_EMAIL_DOMAIN} address.` };
  const { error: err } = await supabase.from("admins").upsert({ email: e }, { onConflict: "email" });
  if (err) return { ok: false, error: err.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function removeAdmin(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { data } = await supabase.auth.getClaims();
  if ((data?.claims?.email as string | undefined)?.toLowerCase() === email.toLowerCase()) {
    return { ok: false, error: "You can't remove yourself." };
  }
  const { error: err } = await supabase.from("admins").delete().eq("email", email.toLowerCase());
  if (err) return { ok: false, error: err.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Weekly digest ───────────────────────────────────────────────────

export interface DigestSettingsInput {
  enabled: boolean;
  channel: string;
  editors_note: string;
}

const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;

export async function saveDigestSettings(input: DigestSettingsInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const channel = String(input.channel ?? "").trim();
  if (channel && !CHANNEL_ID.test(channel)) {
    return { ok: false, error: "Use the channel ID (starts with C, from the channel's About tab), not its name." };
  }
  if (input.enabled && !channel) return { ok: false, error: "Add the channel ID before enabling the digest." };
  const { data: claims } = await supabase.auth.getClaims();
  const { error: e } = await supabase
    .from("digest_settings")
    .update({
      enabled: !!input.enabled,
      channel,
      editors_note: String(input.editors_note ?? "").trim().slice(0, 300),
      updated_at: new Date().toISOString(),
      updated_by: (claims?.claims?.email as string | undefined) ?? null,
    })
    .eq("id", true);
  if (e) return { ok: false, error: e.message };
  revalidatePath("/admin");
  return { ok: true, data: undefined };
}

/** DM the current admin the digest for the chosen window. Never touches the channel. */
export async function sendDigestTest(window: WindowKind): Promise<ActionResult<{ where: string }>> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  if (!slackConfigured()) return { ok: false, error: slackErrorText("slack_not_configured") };
  const { data: claims } = await supabase.auth.getClaims();
  const email = (claims?.claims?.email as string | undefined)?.toLowerCase();
  if (!email) return { ok: false, error: "Couldn't read your email from the session." };

  const settings = await getDigestSettings(supabase);
  const w = windowFor(window);
  const composed = await composeDigest(supabase, w, settings.editors_note);
  const dm = await openSlackDm(email);
  if (!dm.ok) return { ok: false, error: slackErrorText(dm.error) };
  const posted = await postSlackMessage(dm.channel, composed.message);
  if (!posted.ok) return { ok: false, error: slackErrorText(posted.error) };
  await recordRun(supabase, { weekStart: w.weekStart, kind: "test", channel: posted.channel, ts: posted.ts, postedBy: email, composed });
  revalidatePath("/admin");
  return { ok: true, data: { where: `your Slack DMs (${w.label})` } };
}

/** Post to the configured channel now. Refuses a second channel post for the same week unless forced. */
export async function sendDigestNow(window: WindowKind, force: boolean): Promise<ActionResult<{ where: string }>> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  if (!slackConfigured()) return { ok: false, error: slackErrorText("slack_not_configured") };
  const { data: claims } = await supabase.auth.getClaims();
  const email = (claims?.claims?.email as string | undefined)?.toLowerCase() ?? "admin";

  const settings = await getDigestSettings(supabase);
  if (!settings.channel) return { ok: false, error: "Add the channel ID first." };
  const w = windowFor(window);
  const already = await hasChannelRun(supabase, w.weekStart);
  if (already && !force) {
    return { ok: false, error: `The channel already got the digest for the week of ${w.weekStart}. Tick “Post again anyway” to resend.` };
  }
  const composed = await composeDigest(supabase, w, settings.editors_note);
  const posted = await postSlackMessage(settings.channel, composed.message);
  if (!posted.ok) return { ok: false, error: slackErrorText(posted.error) };
  await recordRun(supabase, {
    weekStart: w.weekStart,
    kind: already ? "resend" : "channel",
    channel: posted.channel,
    ts: posted.ts,
    postedBy: email,
    composed,
  });
  if (settings.editors_note) await supabase.from("digest_settings").update({ editors_note: "" }).eq("id", true);
  revalidatePath("/admin");
  return { ok: true, data: { where: `#channel ${settings.channel} (${w.label})` } };
}

// ── Slack assistant tester ──────────────────────────────────────────
export interface AskResult {
  blocks: Record<string, unknown>[];
  text: string;
  matches: number;
  candidates: number;
  shortlisted: boolean;
  model: string;
  fallback: boolean;
  error?: string;
}

/** Run the assistant exactly as Slack would, but return the reply here instead of posting it. */
export async function askAssistant(question: string): Promise<ActionResult<AskResult>> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const q = String(question ?? "").trim().slice(0, 500);
  if (!q) return { ok: false, error: "Ask something first." };
  const { data: claims } = await supabase.auth.getClaims();
  try {
    const handled = await handleAsk(supabase, { source: "admin-test", question: q, askerName: (claims?.claims?.email as string | undefined)?.split("@")[0] });
    revalidatePath("/admin");
    return {
      ok: true,
      data: {
        blocks: handled.message.blocks,
        text: handled.message.text,
        matches: handled.result.matches.length,
        candidates: handled.candidates,
        shortlisted: handled.shortlisted,
        model: handled.result.model,
        fallback: handled.result.fallback,
        error: handled.result.error,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
