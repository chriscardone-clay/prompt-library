"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/draft";
import { SKILL_BUCKET } from "@/lib/constants";
import { canEdit, getCurrentUser, getPrompt, workflowsEnabled } from "@/lib/data";
import { EXPIRY_DAYS, type ExpiryDays, newShareToken, sharePrefix } from "@/lib/shares";
import { getRequestOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Prompt, SkillFile } from "@/lib/types";
import { workflowAttachments, workflowDoc } from "@/lib/workflows";

type Service = ReturnType<typeof createServiceClient>;

export interface PublishInput {
  label: string;
  expiresDays: ExpiryDays;
  /** Names of the workflow's attachments to include. */
  attachments: string[];
}

/** The workflow, if the signed-in person may publish links for it. */
async function loadForSharing(promptId: string): Promise<{ prompt: Prompt; uid: string; service: Service } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await workflowsEnabled())) return { error: "Workflows aren't available to you yet." };
  const prompt = await getPrompt(promptId);
  if (!prompt || prompt.kind !== "workflow") return { error: "Workflow not found." };
  if (!canEdit(prompt, user)) return { error: "Only the owner and editors can publish links." };
  if (!prompt.workflow.customerReady) return { error: "Mark the workflow customer-ready before publishing a link." };
  let service: Service;
  try {
    service = createServiceClient();
  } catch {
    return { error: "Publishing links isn't set up on this server (SUPABASE_SERVICE_ROLE_KEY)." };
  }
  return { prompt, uid: user.id, service };
}

/** Copy the chosen attachments into the share's own folder and return their entries. */
async function copyAttachments(service: Service, prompt: Prompt, shareId: string, names: string[]): Promise<SkillFile[] | { error: string }> {
  const wanted = new Set(names);
  const out: SkillFile[] = [];
  for (const f of workflowAttachments(prompt.files)) {
    if (!wanted.has(f.name) || !f.path) continue;
    const to = `${sharePrefix(shareId)}/${f.name}`;
    const { error } = await service.storage.from(SKILL_BUCKET).copy(f.path, to);
    if (error) return { error: `Couldn't copy ${f.name}: ${error.message}` };
    const entry: SkillFile = { name: f.name, content: "", path: to, size: f.size ?? 0 };
    if (f.type) entry.type = f.type;
    out.push(entry);
  }
  return out;
}

async function removeShareFiles(service: Service, shareId: string) {
  const { data } = await service.storage.from(SKILL_BUCKET).list(sharePrefix(shareId), { limit: 100 });
  const paths = (data ?? []).map((o) => `${sharePrefix(shareId)}/${o.name}`);
  if (paths.length) await service.storage.from(SKILL_BUCKET).remove(paths).catch(() => undefined);
}

function snapshot(prompt: Prompt) {
  const doc = workflowDoc(prompt.files)!;
  return {
    title: prompt.title.slice(0, 200),
    description: prompt.description.slice(0, 600),
    file: { name: doc.name, content: doc.content },
    source_updated_at: prompt.updatedAt,
  };
}

/** Publish a read-only link to the workflow as it is now. */
export async function publishShare(promptId: string, input: PublishInput): Promise<ActionResult<{ id: string; url: string }>> {
  const ctx = await loadForSharing(promptId);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { prompt, uid, service } = ctx;
  if (!workflowDoc(prompt.files)) return { ok: false, error: "This workflow has no .md to share." };
  const days = (EXPIRY_DAYS as readonly number[]).includes(input.expiresDays) ? input.expiresDays : 0;

  const id = randomUUID();
  const token = newShareToken();
  const attachments = await copyAttachments(service, prompt, id, input.attachments ?? []);
  if ("error" in attachments) {
    await removeShareFiles(service, id);
    return { ok: false, error: attachments.error };
  }
  const { error } = await service.from("workflow_shares").insert({
    id,
    prompt_id: prompt.id,
    token,
    label: String(input.label ?? "").trim().slice(0, 120),
    ...snapshot(prompt),
    attachments,
    created_by: uid,
    expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null,
  });
  if (error) {
    await removeShareFiles(service, id);
    return { ok: false, error: error.message };
  }
  revalidatePath(`/prompts/${prompt.id}`);
  return { ok: true, data: { id, url: `${await getRequestOrigin()}/s/${token}` } };
}

/** The share row, if the signed-in person can see it (RLS: owners and editors of its workflow). */
async function ownShare(shareId: string): Promise<{ prompt_id: string; attachments: unknown } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("workflow_shares").select("prompt_id, attachments").eq("id", shareId).is("revoked_at", null).maybeSingle();
  return (data as { prompt_id: string; attachments: unknown } | null) ?? null;
}

/** Point an existing link at the workflow as it is now. The URL stays the same. */
export async function updateShare(shareId: string): Promise<ActionResult> {
  const share = await ownShare(shareId);
  if (!share) return { ok: false, error: "Link not found." };
  const ctx = await loadForSharing(share.prompt_id);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { prompt, service } = ctx;
  const names = (Array.isArray(share.attachments) ? share.attachments : [])
    .map((a) => (a && typeof a === "object" ? String((a as { name?: unknown }).name ?? "") : ""))
    .filter(Boolean);
  await removeShareFiles(service, shareId);
  const attachments = await copyAttachments(service, prompt, shareId, names);
  if ("error" in attachments) return { ok: false, error: attachments.error };
  const { error } = await service
    .from("workflow_shares")
    .update({ ...snapshot(prompt), attachments, updated_at: new Date().toISOString() })
    .eq("id", shareId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/prompts/${prompt.id}`);
  return { ok: true, data: undefined };
}

/** Turn a link off for good. Anyone opening it sees "This link isn't available". */
export async function revokeShare(shareId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const share = await ownShare(shareId);
  if (!share) return { ok: false, error: "Link not found." };
  const prompt = await getPrompt(share.prompt_id);
  if (!prompt || !canEdit(prompt, user)) return { ok: false, error: "Only the owner and editors can revoke links." };
  let service: Service;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, error: "Links aren't set up on this server (SUPABASE_SERVICE_ROLE_KEY)." };
  }
  const { error } = await service.from("workflow_shares").update({ revoked_at: new Date().toISOString() }).eq("id", shareId);
  if (error) return { ok: false, error: error.message };
  await removeShareFiles(service, shareId);
  revalidatePath(`/prompts/${share.prompt_id}`);
  return { ok: true, data: undefined };
}
