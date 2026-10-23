"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { ActionResult } from "@/app/actions";
import { DEFAULT_DUE_DAYS, RUBRIC } from "@/lib/approval";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { enablementEnabled, getCurrentUser, getPrompt, isAdmin } from "@/lib/data";
import { isReviewer } from "@/lib/enablement";
import { type Decision, notifyDecision, notifyRequest } from "@/lib/enablementNotify";
import { createClient } from "@/lib/supabase/server";

const NOTE_MAX = 2000;
const NAME_MAX = 60;

/** Signed in and in the ENABLEMENT_APPROVED flag. The SQL functions enforce roles again. */
async function requireFeature() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await enablementEnabled())) return { user, supabase: null, error: "Enablement Approved isn't available to you yet." as const };
  return { user, supabase: await createClient(), error: null };
}

async function requireReviewer() {
  const r = await requireFeature();
  if (r.error) return r;
  if (!(await isReviewer())) return { ...r, supabase: null, error: "Only Enablement reviewers can do that." as const };
  return r;
}

function done(promptId?: string): ActionResult {
  revalidatePath("/", "layout");
  if (promptId) revalidatePath(`/prompts/${promptId}`);
  return { ok: true, data: undefined };
}

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

/** Postgres raises friendly messages from the review_* functions; surface those as-is. */
function sqlError(e: { message: string }): ActionResult {
  return { ok: false, error: e.message || "Something went wrong." };
}

// ── Owner / editors ─────────────────────────────────────────────────
export async function requestReview(promptId: string, useCaseId: string | null, note: string): Promise<ActionResult> {
  const { supabase, error, user } = await requireFeature();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.rpc("review_request", { p_prompt: promptId, p_use_case: useCaseId || null, p_note: clean(note, NOTE_MAX) });
  if (e) return sqlError(e);
  const p = await getPrompt(promptId);
  if (p) {
    const { data: uc } = useCaseId ? await supabase.from("enablement_use_cases").select("name").eq("id", useCaseId).maybeSingle() : { data: null };
    after(() => notifyRequest({ promptId, title: p.title, kind: p.kind, requester: user.name, note, useCase: (uc as { name: string } | null)?.name }));
  }
  return done(promptId);
}

export async function withdrawReview(promptId: string): Promise<ActionResult> {
  const { supabase, error } = await requireFeature();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.rpc("review_withdraw", { p_prompt: promptId });
  if (e) return sqlError(e);
  return done(promptId);
}

// ── Reviewers ───────────────────────────────────────────────────────
export interface DecisionInput {
  promptId: string;
  decision: "approved" | "changes_requested" | "declined";
  gold?: boolean;
  useCaseId: string | null;
  note: string;
  rubric: Record<string, boolean>;
  dueDays?: number;
}

export async function decideReview(input: DecisionInput): Promise<ActionResult> {
  const { supabase, error, user } = await requireReviewer();
  if (error) return { ok: false, error };
  if ((input.decision === "changes_requested" || input.decision === "declined") && !input.note.trim()) {
    return { ok: false, error: "Add a note so the owner knows what to change." };
  }
  const rubric = Object.fromEntries(RUBRIC.map((r) => [r.key, !!input.rubric[r.key]]));
  const before = await getPrompt(input.promptId);
  const { error: e } = await supabase.rpc("review_decide", {
    p_prompt: input.promptId,
    p_decision: input.decision,
    p_tier: input.decision === "approved" ? (input.gold ? "gold" : "approved") : null,
    p_use_case: input.useCaseId || null,
    p_note: clean(input.note, NOTE_MAX),
    p_rubric: rubric,
    p_due_days: input.dueDays ?? DEFAULT_DUE_DAYS,
  });
  if (e) return sqlError(e);
  if (before) {
    const { data: open } = await supabase
      .from("prompt_reviews")
      .select("requester:profiles!prompt_reviews_requested_by_fkey ( email )")
      .eq("prompt_id", input.promptId)
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const requester = (open as { requester: { email: string } | null } | null)?.requester?.email;
    const { data: uc } = input.useCaseId ? await supabase.from("enablement_use_cases").select("name").eq("id", input.useCaseId).maybeSingle() : { data: null };
    const decision: Decision = input.decision === "approved" ? (input.gold ? "gold" : "approved") : input.decision;
    const to = [before.owner.email, ...(requester && requester !== user.email ? [requester] : [])];
    after(() => notifyDecision({ to, promptId: input.promptId, title: before.title, decision, reviewer: user.name, note: input.note, useCase: (uc as { name: string } | null)?.name }));
  }
  return done(input.promptId);
}

export async function revokeApproval(promptId: string, note: string): Promise<ActionResult> {
  const { supabase, error, user } = await requireReviewer();
  if (error) return { ok: false, error };
  if (!note.trim()) return { ok: false, error: "Say why, so the owner knows." };
  const before = await getPrompt(promptId);
  const { error: e } = await supabase.rpc("review_revoke", { p_prompt: promptId, p_note: clean(note, NOTE_MAX) });
  if (e) return sqlError(e);
  if (before) after(() => notifyDecision({ to: [before.owner.email], promptId, title: before.title, decision: "revoked", reviewer: user.name, note }));
  return done(promptId);
}

export async function setOutdated(promptId: string, outdated: boolean, note: string): Promise<ActionResult> {
  const { supabase, error, user } = await requireReviewer();
  if (error) return { ok: false, error };
  if (outdated && !note.trim()) return { ok: false, error: "Say what's out of date, so the owner knows what to fix." };
  const before = await getPrompt(promptId);
  const { error: e } = await supabase.rpc("review_set_outdated", { p_prompt: promptId, p_outdated: outdated, p_note: clean(note, NOTE_MAX) });
  if (e) return sqlError(e);
  if (before && outdated) after(() => notifyDecision({ to: [before.owner.email], promptId, title: before.title, decision: "outdated", reviewer: user.name, note }));
  return done(promptId);
}

export async function setGold(useCaseId: string, promptId: string | null): Promise<ActionResult> {
  const { supabase, error, user } = await requireReviewer();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.rpc("review_set_gold", { p_use_case: useCaseId, p_prompt: promptId });
  if (e) return sqlError(e);
  if (promptId) {
    const p = await getPrompt(promptId);
    const { data: uc } = await supabase.from("enablement_use_cases").select("name").eq("id", useCaseId).maybeSingle();
    if (p) after(() => notifyDecision({ to: [p.owner.email], promptId, title: p.title, decision: "gold", reviewer: user.name, note: "", useCase: (uc as { name: string } | null)?.name }));
  }
  return done(promptId ?? undefined);
}

export async function saveUseCase(input: { id?: string; name: string; description: string; archived?: boolean }): Promise<ActionResult> {
  const { supabase, error } = await requireReviewer();
  if (error) return { ok: false, error };
  const name = clean(input.name, NAME_MAX + 1).replace(/\s+/g, " ");
  if (!name || name.length > NAME_MAX) return { ok: false, error: `Names are 1–${NAME_MAX} characters.` };
  const row = { name, description: clean(input.description, 300), archived: !!input.archived };
  const res = input.id
    ? await supabase.from("enablement_use_cases").update(row).eq("id", input.id)
    : await supabase.from("enablement_use_cases").insert({
        ...row,
        position: (((await supabase.from("enablement_use_cases").select("position").order("position", { ascending: false }).limit(1)).data?.[0] as { position: number } | undefined)?.position ?? 0) + 1,
      });
  if (res.error) return { ok: false, error: res.error.code === "23505" ? `“${name}” already exists.` : res.error.message };
  return done();
}

// ── Admins: who reviews ─────────────────────────────────────────────
export async function addReviewer(email: string): Promise<ActionResult> {
  const { supabase, error, user } = await requireFeature();
  if (error) return { ok: false, error };
  if (!(await isAdmin())) return { ok: false, error: "Only admins can add reviewers." };
  const e = email.trim().toLowerCase();
  if (!e.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return { ok: false, error: `Reviewers need an @${ALLOWED_EMAIL_DOMAIN} address.` };
  const { error: err } = await supabase.from("enablement_reviewers").upsert({ email: e, added_by: user.email }, { onConflict: "email" });
  if (err) return { ok: false, error: err.message };
  return done();
}

export async function removeReviewer(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireFeature();
  if (error) return { ok: false, error };
  if (!(await isAdmin())) return { ok: false, error: "Only admins can remove reviewers." };
  const { error: err } = await supabase.from("enablement_reviewers").delete().eq("email", email.toLowerCase());
  if (err) return { ok: false, error: err.message };
  return done();
}
