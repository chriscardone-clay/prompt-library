"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { ALLOWED_EMAIL_DOMAIN, SKILL_BUCKET } from "@/lib/constants";
import { getCatalog } from "@/lib/data";
import { type ActionResult, normaliseDraft } from "@/lib/draft";
import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";
import { esc } from "@/lib/digest/blocks";
import { getSiteUrl } from "@/lib/site";
import { openSlackDm, postSlackMessage, slackConfigured } from "@/lib/slack";
import { getRequestOrigin } from "@/lib/site";
import type { PromptDraft } from "@/lib/types";

export type { ActionResult } from "@/lib/draft";

// ── Auth ────────────────────────────────────────────────────────────
export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const safeNext = safeNextPath(String(formData.get("next") || "/"));
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
  // Inside the iframe the verifier cookie must be SameSite=None + Partitioned.
  const supabase = await createClient({ pkceCookie: "partitioned" });
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidatePrompt(id?: string) {
  revalidatePath("/");
  revalidatePath("/mine");
  if (id) revalidatePath(`/prompts/${id}`);
}

// ── Prompts ─────────────────────────────────────────────────────────
export async function createPrompt(
  input: PromptDraft,
  parentId: string | null,
  /** Id the editor generated up front so binary uploads could target its folder. */
  clientId?: string,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, uid, email } = await requireUser();

  // The id is chosen before insert (by the editor, so uploads can use it) and
  // the insert has no RETURNING clause: a RETURNING clause is checked against
  // the SELECT policy, whose owner/editor lookup runs on the statement's
  // snapshot and can't yet see the row, so private prompts would be rejected.
  const id = clientId && UUID_RE.test(clientId) ? clientId.toLowerCase() : crypto.randomUUID();
  const { data: clash } = await supabase.from("prompts").select("id").eq("id", id).maybeSingle();
  if (clash) return { ok: false, error: "That draft was already published. Refresh and try again." };

  const v = normaliseDraft(input, parentId ? [id, parentId] : [id], await getCatalog());
  if (!v.ok) return v;
  const d = v.data;

  // A fork copies the parent's binary files into its own folder so it keeps
  // working even if the parent later becomes private or is deleted.
  if (parentId) {
    for (const f of d.files) {
      if (!f.path || !f.path.startsWith(`${parentId}/`)) continue;
      const to = `${id}/${f.path.slice(parentId.length + 1)}`;
      const { error } = await supabase.storage.from(SKILL_BUCKET).copy(f.path, to);
      if (error) return { ok: false, error: `Couldn't copy ${f.name}: ${error.message}` };
      f.path = to;
    }
  }
  const { error } = await supabase.from("prompts").insert({
    id,
    kind: d.kind,
    title: d.title,
    description: d.description,
    body: d.body,
    notes: d.notes,
    files: d.files,
    links: d.links,
    audiences: d.audiences,
    visibility: d.visibility,
    owner_id: uid,
    parent_id: parentId,
    fork_note: parentId ? d.forkNote : "",
  });
  if (error) return { ok: false, error: error.message };
  const appsRes = await supabase
    .from("prompt_apps")
    .insert(d.apps.map((a) => ({ prompt_id: id, app: a.app, surfaces: a.surfaces, model: a.model, model_required: a.required })));
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

  const { data: existing, error: loadErr } = await supabase
    .from("prompts")
    .select("id, kind, owner_id, parent_id, owner:profiles!prompts_owner_id_fkey ( email ), prompt_editors ( email )")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !existing) return { ok: false, error: "Prompt not found." };

  const parentFolder = typeof existing.parent_id === "string" ? [existing.parent_id] : [];
  const v = normaliseDraft(input, [id, ...parentFolder], await getCatalog());
  if (!v.ok) return v;
  const d = v.data;
  if ((existing.kind ?? "prompt") !== d.kind) {
    return { ok: false, error: "A prompt can't be turned into a skill, or the other way round." };
  }

  const { error } = await supabase
    .from("prompts")
    .update({
      title: d.title,
      description: d.description,
      body: d.body,
      notes: d.notes,
      files: d.files,
      links: d.links,
      audiences: d.audiences,
      visibility: d.visibility,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Replace the app set.
  const del = await supabase.from("prompt_apps").delete().eq("prompt_id", id);
  if (del.error) return { ok: false, error: del.error.message };
  const ins = await supabase
    .from("prompt_apps")
    .insert(d.apps.map((a) => ({ prompt_id: id, app: a.app, surfaces: a.surfaces, model: a.model, model_required: a.required })));
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
  // Collect stored binaries first (the row must still exist for the read policy).
  const paths = UUID_RE.test(id) ? await listStorageFolder(supabase, id) : [];
  // delete_prompt re-parents forks to the deleted item's parent, then deletes.
  const { error } = await supabase.rpc("delete_prompt", { p_id: id });
  if (error) return { ok: false, error: error.message };
  if (paths.length) {
    // Best effort: an orphaned object is harmless, a failed delete shouldn't be.
    await supabase.storage.from(SKILL_BUCKET).remove(paths).catch(() => undefined);
  }
  revalidatePrompt(id);
  return { ok: true, data: undefined };
}

/** Every object path under a storage folder, recursively. */
async function listStorageFolder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return;
    const { data } = await supabase.storage.from(SKILL_BUCKET).list(dir, { limit: 1000 });
    for (const item of data ?? []) {
      const full = `${dir}/${item.name}`;
      if (item.id) out.push(full);
      else await walk(full, depth + 1); // folders come back without an id
    }
  };
  await walk(prefix, 0);
  return out;
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

export async function toggleFavorite(promptId: string, on: boolean): Promise<ActionResult> {
  const { supabase, uid } = await requireUser();
  const res = on
    ? await supabase
        .from("prompt_favorites")
        .upsert({ prompt_id: promptId, user_id: uid }, { onConflict: "prompt_id,user_id" })
    : await supabase.from("prompt_favorites").delete().match({ prompt_id: promptId, user_id: uid });
  if (res.error) return { ok: false, error: res.error.message };
  revalidatePrompt(promptId);
  revalidatePath("/favorites");
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
  after(() => notifyFeedbackPosted(supabase, promptId, uid, t));
  return { ok: true, data: undefined };
}

export async function replyToFeedback(
  feedbackId: string,
  promptId: string,
  reply: string,
): Promise<ActionResult> {
  const { supabase, uid } = await requireUser();
  const r = reply.trim();
  if (!r) return { ok: false, error: "Write a reply first." };
  const { error } = await supabase.from("feedback").update({ reply: r }).eq("id", feedbackId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/prompts/${promptId}`);
  after(() => notifyFeedbackReplied(supabase, feedbackId, promptId, uid, r));
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

// ── Slack DMs for feedback ──────────────────────────────────────────
type Db = Awaited<ReturnType<typeof createClient>>;

async function nameAndEmail(supabase: Db, id: string): Promise<{ name: string; email: string } | null> {
  const { data } = await supabase.from("profiles").select("name, email").eq("id", id).maybeSingle();
  return (data as { name: string; email: string } | null) ?? null;
}

function quote(s: string, max = 280): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Tell the owner someone left feedback (unless they left it themselves). */
async function notifyFeedbackPosted(supabase: Db, promptId: string, authorId: string, text: string) {
  if (!slackConfigured()) return;
  try {
    const { data: p } = await supabase.from("prompts").select("title, owner_id, kind").eq("id", promptId).maybeSingle();
    const prompt = p as { title: string; owner_id: string; kind: string } | null;
    if (!prompt || prompt.owner_id === authorId) return;
    const [owner, author] = await Promise.all([nameAndEmail(supabase, prompt.owner_id), nameAndEmail(supabase, authorId)]);
    if (!owner) return;
    const dm = await openSlackDm(owner.email);
    if (!dm.ok) return console.warn("[slack] feedback DM: no DM channel", dm.error);
    const url = `${getSiteUrl()}/prompts/${promptId}#feedback`;
    const kind = prompt.kind === "skill" ? "skill" : "prompt";
    const who = author?.name ?? "Someone";
    const msg = {
      text: `${who} left feedback on your ${kind} “${prompt.title}”: ${quote(text)}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `💬 *${esc(who)}* left feedback on your ${kind} *<${url}|${esc(prompt.title)}>*` } },
        { type: "section", text: { type: "mrkdwn", text: `> ${esc(quote(text)).replace(/\n/g, "\n> ")}` } },
        {
          type: "actions",
          elements: [{ type: "button", text: { type: "plain_text", text: "Reply in the library" }, url, action_id: "open_feedback" }],
        },
      ],
    };
    const r = await postSlackMessage(dm.channel, msg);
    if (!r.ok) console.warn("[slack] feedback DM failed", r.error);
  } catch (err) {
    console.warn("[slack] feedback DM error", err instanceof Error ? err.message : err);
  }
}

/** Tell the person who left feedback that the owner replied (unless they replied to themselves). */
async function notifyFeedbackReplied(supabase: Db, feedbackId: string, promptId: string, replierId: string, reply: string) {
  if (!slackConfigured()) return;
  try {
    const [{ data: f }, { data: p }] = await Promise.all([
      supabase.from("feedback").select("user_id").eq("id", feedbackId).maybeSingle(),
      supabase.from("prompts").select("title, kind").eq("id", promptId).maybeSingle(),
    ]);
    const fb = f as { user_id: string } | null;
    const prompt = p as { title: string; kind: string } | null;
    if (!fb || !prompt || fb.user_id === replierId) return;
    const [author, replier] = await Promise.all([nameAndEmail(supabase, fb.user_id), nameAndEmail(supabase, replierId)]);
    if (!author) return;
    const dm = await openSlackDm(author.email);
    if (!dm.ok) return console.warn("[slack] reply DM: no DM channel", dm.error);
    const url = `${getSiteUrl()}/prompts/${promptId}#feedback`;
    const kind = prompt.kind === "skill" ? "skill" : "prompt";
    const who = replier?.name ?? "The owner";
    const msg = {
      text: `${who} replied to your feedback on “${prompt.title}”: ${quote(reply)}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `↩️ *${esc(who)}* replied to your feedback on the ${kind} *<${url}|${esc(prompt.title)}>*` } },
        { type: "section", text: { type: "mrkdwn", text: `> ${esc(quote(reply)).replace(/\n/g, "\n> ")}` } },
        { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "See the thread" }, url, action_id: "open_reply" }] },
      ],
    };
    const r = await postSlackMessage(dm.channel, msg);
    if (!r.ok) console.warn("[slack] reply DM failed", r.error);
  } catch (err) {
    console.warn("[slack] reply DM error", err instanceof Error ? err.message : err);
  }
}
