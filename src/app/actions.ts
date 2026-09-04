"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ALLOWED_EMAIL_DOMAIN,
  isApp,
  isAudience,
  isVisibility,
  SURFACES,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/lib/site";
import type { PromptApp, PromptDraft } from "@/lib/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Auth ────────────────────────────────────────────────────────────
export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const nextPath = String(formData.get("next") || "/");
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  // Return to whichever host the user started on (custom domain, vercel.app, localhost).
  const origin = await getRequestOrigin();
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        hd: ALLOWED_EMAIL_DOMAIN, // hint Google to the Workspace domain
        prompt: "select_account",
      },
    },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

/**
 * Embedded sign-in (the app inside a Notion iframe). Starts the OAuth flow
 * from the iframe's own cookie partition and returns Google's URL for the
 * caller to open in a popup; Google refuses to run inside an iframe. The
 * popup lands on /auth/embed-done, which hands the one-time code back to the
 * iframe, and /auth/embed-callback exchanges it using the PKCE verifier cookie
 * this call stored.
 */
export async function beginEmbedSignIn(): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const origin = await getRequestOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/embed-done`,
      skipBrowserRedirect: true,
      queryParams: { hd: ALLOWED_EMAIL_DOMAIN, prompt: "select_account" },
    },
  });
  if (error || !data.url) return { ok: false, error: error?.message ?? "Could not start sign-in." };
  return { ok: true, data: { url: data.url } };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ── Helpers ─────────────────────────────────────────────────────────
async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  const email = (data?.claims?.email as string | undefined)?.toLowerCase();
  if (!uid || !email) redirect("/login");
  return { supabase, uid, email };
}

function normaliseDraft(input: PromptDraft): ActionResult<PromptDraft> {
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const body = (input.body ?? "").replace(/\r\n/g, "\n");
  if (!title) return { ok: false, error: "Add a title." };
  if (title.length > 200) return { ok: false, error: "Title is too long (200 characters max)." };
  if (!body.trim()) return { ok: false, error: "Add the prompt itself." };
  if (body.length > 50_000) return { ok: false, error: "Prompt is too long." };
  if (description.length > 600) return { ok: false, error: "Description is too long." };
  const notes = (input.notes ?? "").replace(/\r\n/g, "\n").trim();
  if (notes.length > 5000) return { ok: false, error: "Notes are too long (5000 characters max)." };

  const seen = new Set<string>();
  const apps: PromptApp[] = [];
  for (const a of input.apps ?? []) {
    if (!isApp(a.app) || seen.has(a.app)) continue;
    seen.add(a.app);
    const allowed = SURFACES[a.app] ?? [];
    apps.push({ app: a.app, surfaces: (a.surfaces ?? []).filter((s) => allowed.includes(s)) });
  }
  if (!apps.length) return { ok: false, error: "Pick at least one tool." };

  if (!isAudience(input.audience)) return { ok: false, error: "Pick an audience." };
  if (!isVisibility(input.visibility)) return { ok: false, error: "Pick a visibility." };

  const editors = Array.from(
    new Set((input.editors ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)),
  );
  for (const e of editors) {
    if (!e.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
      return { ok: false, error: `Editors need an @${ALLOWED_EMAIL_DOMAIN} address (${e}).` };
    }
  }

  return {
    ok: true,
    data: {
      title,
      description,
      body,
      notes,
      apps,
      audience: input.audience,
      visibility: input.visibility,
      forkNote: (input.forkNote ?? "").trim().slice(0, 600),
      editors,
    },
  };
}

function revalidatePrompt(id?: string) {
  revalidatePath("/");
  revalidatePath("/mine");
  if (id) revalidatePath(`/prompts/${id}`);
}

// ── Prompts ─────────────────────────────────────────────────────────
export async function createPrompt(
  input: PromptDraft,
  parentId: string | null,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, uid, email } = await requireUser();
  const v = normaliseDraft(input);
  if (!v.ok) return v;
  const d = v.data;

  // Generate the id here and insert without RETURNING. A RETURNING clause is
  // checked against the SELECT policy, whose owner/editor lookup runs on the
  // statement's snapshot and can't yet see the row being inserted, so private
  // prompts would be rejected with "new row violates row-level security".
  const id = crypto.randomUUID();
  const { error } = await supabase.from("prompts").insert({
    id,
    title: d.title,
    description: d.description,
    body: d.body,
    notes: d.notes,
    audience: d.audience,
    visibility: d.visibility,
    owner_id: uid,
    parent_id: parentId,
    fork_note: parentId ? d.forkNote : "",
  });
  if (error) return { ok: false, error: error.message };
  const appsRes = await supabase
    .from("prompt_apps")
    .insert(d.apps.map((a) => ({ prompt_id: id, app: a.app, surfaces: a.surfaces })));
  if (appsRes.error) return { ok: false, error: appsRes.error.message };

  const editors = d.editors.filter((e) => e !== email);
  if (editors.length) {
    const edRes = await supabase
      .from("prompt_editors")
      .insert(editors.map((e) => ({ prompt_id: id, email: e })));
    if (edRes.error) return { ok: false, error: edRes.error.message };
  }

  revalidatePrompt(id);
  if (parentId) revalidatePath(`/prompts/${parentId}`);
  return { ok: true, data: { id } };
}

export async function updatePrompt(
  id: string,
  input: PromptDraft,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, uid } = await requireUser();
  const v = normaliseDraft(input);
  if (!v.ok) return v;
  const d = v.data;

  const { data: existing, error: loadErr } = await supabase
    .from("prompts")
    .select("id, owner_id, owner:profiles!prompts_owner_id_fkey ( email ), prompt_editors ( email )")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !existing) return { ok: false, error: "Prompt not found." };

  const { error } = await supabase
    .from("prompts")
    .update({
      title: d.title,
      description: d.description,
      body: d.body,
      notes: d.notes,
      audience: d.audience,
      visibility: d.visibility,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Replace the app set.
  const del = await supabase.from("prompt_apps").delete().eq("prompt_id", id);
  if (del.error) return { ok: false, error: del.error.message };
  const ins = await supabase
    .from("prompt_apps")
    .insert(d.apps.map((a) => ({ prompt_id: id, app: a.app, surfaces: a.surfaces })));
  if (ins.error) return { ok: false, error: ins.error.message };

  // Diff editors. Only the owner may remove editors; anyone editing may add.
  const ownerRow = existing.owner as unknown as { email: string } | { email: string }[] | null;
  const ownerEmail = (Array.isArray(ownerRow) ? ownerRow[0]?.email : ownerRow?.email)?.toLowerCase();
  const current = new Set(
    ((existing.prompt_editors ?? []) as { email: string }[]).map((e) => e.email.toLowerCase()),
  );
  const wanted = new Set(d.editors.filter((e) => e !== ownerEmail));
  const toAdd = [...wanted].filter((e) => !current.has(e));
  const toRemove = [...current].filter((e) => !wanted.has(e));
  if (toAdd.length) {
    const r = await supabase
      .from("prompt_editors")
      .insert(toAdd.map((e) => ({ prompt_id: id, email: e })));
    if (r.error) return { ok: false, error: r.error.message };
  }
  if (toRemove.length && existing.owner_id === uid) {
    const r = await supabase
      .from("prompt_editors")
      .delete()
      .eq("prompt_id", id)
      .in("email", toRemove);
    if (r.error) return { ok: false, error: r.error.message };
  }

  revalidatePrompt(id);
  return { ok: true, data: { id } };
}

export async function deletePrompt(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("prompts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePrompt(id);
  return { ok: true, data: undefined };
}

export async function toggleUpvote(promptId: string, on: boolean): Promise<ActionResult> {
  const { supabase, uid } = await requireUser();
  const res = on
    ? await supabase
        .from("prompt_upvotes")
        .upsert({ prompt_id: promptId, user_id: uid }, { onConflict: "prompt_id,user_id" })
    : await supabase.from("prompt_upvotes").delete().match({ prompt_id: promptId, user_id: uid });
  if (res.error) return { ok: false, error: res.error.message };
  revalidatePrompt(promptId);
  return { ok: true, data: undefined };
}

export async function restoreVersion(versionId: string): Promise<ActionResult<{ id: string }>> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.rpc("restore_prompt_version", { p_version: versionId });
  if (error) return { ok: false, error: error.message };
  const id = data as string;
  revalidatePrompt(id);
  return { ok: true, data: { id } };
}

// ── Feedback ────────────────────────────────────────────────────────
export async function postFeedback(promptId: string, text: string): Promise<ActionResult> {
  const { supabase, uid } = await requireUser();
  const t = text.trim();
  if (!t) return { ok: false, error: "Write something first." };
  if (t.length > 4000) return { ok: false, error: "Feedback is too long." };
  const { error } = await supabase
    .from("feedback")
    .insert({ prompt_id: promptId, user_id: uid, text: t });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/prompts/${promptId}`);
  return { ok: true, data: undefined };
}

export async function replyToFeedback(
  feedbackId: string,
  promptId: string,
  reply: string,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const r = reply.trim();
  if (!r) return { ok: false, error: "Write a reply first." };
  const { error } = await supabase.from("feedback").update({ reply: r }).eq("id", feedbackId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/prompts/${promptId}`);
  return { ok: true, data: undefined };
}

export async function setFeedbackResolved(
  feedbackId: string,
  promptId: string,
  resolved: boolean,
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("feedback").update({ resolved }).eq("id", feedbackId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/prompts/${promptId}`);
  return { ok: true, data: undefined };
}
