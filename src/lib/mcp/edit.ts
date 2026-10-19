import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSkillMd } from "@/lib/skills";
import type { Prompt, PromptDraft, SkillFile } from "@/lib/types";
import { checkCatalog, itemShape, qualityNotes, validate } from "./create";
import { findItem, isEditor, type Library } from "./library";

/**
 * Editing an existing prompt or skill from a chat ("make it public", "tighten
 * the prompt", "add Sales as a team"). Same permissions as the site: owners
 * and editors may edit; only the owner may remove editors; kind never
 * changes. Every content change is snapshotted by the version-history trigger,
 * so a bad edit can be restored on the site.
 */

export const editShape = {
  id: z.string().min(1).describe("Item id (or its clayprompts.com link)"),
  based_on: z
    .string()
    .optional()
    .describe("The \"based on\" value preview_changes returned. Pass it to update_item so a change someone made on the site in the meantime isn't overwritten"),
  title: itemShape.title.optional(),
  description: itemShape.description,
  body: z.string().max(50_000).optional().describe("Prompts: the full new prompt text (not a diff). Skills: new SKILL.md content"),
  notes: itemShape.notes,
  files: z
    .array(z.object({ name: z.string().min(1).max(160), content: z.string() }))
    .max(60)
    .optional()
    .describe("Skills only: text files to add, or to replace by name. Files not listed stay as they are"),
  remove_files: z.array(z.string()).max(60).optional().describe("Skills only: file names to delete"),
  apps: itemShape.apps.optional().describe("Replaces the whole list of apps it works in"),
  teams: itemShape.teams.optional().describe("Replaces the whole list of teams"),
  visibility: z.enum(["public", "private"]).optional(),
  links: itemShape.links.describe("Replaces the whole list of links"),
  add_editors: z.array(z.string().email()).max(20).optional().describe("@clay.com teammates to add as editors"),
  remove_editors: z.array(z.string().email()).max(20).optional().describe("Editors to remove (owner only)"),
};
const editSchema = z.object(editShape);
export type EditInput = z.infer<typeof editSchema>;

export interface PreparedEdit {
  ok: boolean;
  error?: string;
  item?: Prompt;
  draft?: PromptDraft;
  changes: string[];
  warnings: string[];
  addEditors: string[];
  removeEditors: string[];
  appsChanged: boolean;
}

function fail(error: string, item?: Prompt): PreparedEdit {
  return { ok: false, error, item, changes: [], warnings: [], addEditors: [], removeEditors: [], appsChanged: false };
}

export function canEditItem(lib: Library, p: Prompt): boolean {
  return p.ownerId === lib.me.id || isEditor(p, lib.me);
}

function lower(s: string) {
  return s.trim().toLowerCase();
}

/** Existing files with `files` added/replaced by name and `remove_files` dropped. Binary files survive unless removed. */
function mergeFiles(existing: SkillFile[], set: { name: string; content: string }[] | undefined, remove: string[] | undefined, body: string | undefined): { files: SkillFile[]; missing: string[] } {
  const removeKeys = new Set((remove ?? []).map(lower));
  const missing = (remove ?? []).filter((r) => !existing.some((f) => lower(f.name) === lower(r)));
  let files = existing.filter((f) => !removeKeys.has(lower(f.name))).map((f) => ({ ...f }));
  const incoming = [...(set ?? [])];
  if (body !== undefined && !incoming.some((f) => isSkillMd(f.name))) {
    const md = files.find((f) => isSkillMd(f.name));
    incoming.push({ name: md?.name ?? "SKILL.md", content: body });
  }
  for (const f of incoming) {
    const i = files.findIndex((x) => lower(x.name) === lower(f.name));
    if (i >= 0) files[i] = { name: files[i].name, content: f.content };
    else files.push({ name: f.name, content: f.content });
  }
  // Keep SKILL.md first, as the editor does.
  files = [...files.filter((f) => isSkillMd(f.name)), ...files.filter((f) => !isSkillMd(f.name))];
  return { files, missing };
}

function short(s: string, n = 120) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || "(empty)";
}

function appsLabel(apps: PromptDraft["apps"]) {
  return apps.map((a) => `${a.app}${a.surfaces.length ? ` (${a.surfaces.join(", ")})` : ""}${a.model ? `, ${a.required ? "requires" : "recommended"} ${a.model}` : ""}`).join("; ");
}

export function prepareEdit(lib: Library, input: EditInput): PreparedEdit {
  const item = findItem(lib, input.id);
  if (!item) return fail(`No item with id ${input.id} that you can see.`);
  if (!canEditItem(lib, item)) return fail(`Only the owner (${item.owner.name}) and editors can change "${item.title}". Suggest forking it on the site, or leaving feedback for the owner.`, item);
  const isOwner = item.ownerId === lib.me.id;

  if (item.kind === "prompt" && (input.files?.length || input.remove_files?.length)) return fail("Prompts don't have files; change the prompt text with body.", item);
  const checked = checkCatalog(lib, input.apps, input.teams);
  const warnings = [...checked.warnings];

  let files = item.files;
  if (item.kind === "skill") {
    const merged = mergeFiles(item.files, input.files, input.remove_files, input.body);
    files = merged.files;
    if (merged.missing.length) warnings.push(`No file named ${merged.missing.map((m) => `"${m}"`).join(", ")} to remove.`);
  }

  const currentEditors = item.editors.map((e) => lower(e.email));
  const removeEditors = (input.remove_editors ?? []).map(lower).filter((e) => currentEditors.includes(e));
  if (removeEditors.length && !isOwner) return fail("Only the owner can remove editors.", item);
  const addEditors = (input.add_editors ?? []).map(lower).filter((e) => !currentEditors.includes(e) && e !== lower(item.owner.email));
  const editors = [...currentEditors.filter((e) => !removeEditors.includes(e)), ...addEditors];

  const draft: PromptDraft = {
    kind: item.kind,
    title: input.title ?? item.title,
    description: input.description ?? item.description,
    body: item.kind === "prompt" ? (input.body ?? item.body) : "",
    notes: input.notes ?? item.notes,
    files,
    links: input.links ? input.links.map((l) => ({ label: l.label ?? "", url: l.url })) : item.links,
    apps: checked.apps ? checked.apps.map((a) => ({ app: a.app, surfaces: a.surfaces ?? [], model: a.model ?? "", required: !!a.model_required })) : item.apps,
    audiences: checked.teams ?? item.audiences,
    visibility: input.visibility ?? item.visibility,
    forkNote: item.forkNote,
    editors,
  };
  const v = validate(lib, draft, item.parentId ? [item.id, item.parentId] : [item.id]);
  if (!v.ok) return { ...fail(v.error, item), warnings };
  const d = v.data;

  const changes: string[] = [];
  if (d.title !== item.title) changes.push(`title: "${item.title}" → "${d.title}"`);
  if (d.description !== item.description) changes.push(`description: "${short(item.description)}" → "${short(d.description)}"`);
  if (d.kind === "prompt" && d.body !== item.body) changes.push(`prompt text: rewritten (${item.body.length} → ${d.body.length} characters)`);
  if (d.notes !== item.notes) changes.push(`how to use: "${short(item.notes)}" → "${short(d.notes)}"`);
  if (d.kind === "skill") {
    const before = new Map(item.files.map((f) => [lower(f.name), f]));
    const after = new Map(d.files.map((f) => [lower(f.name), f]));
    const added = d.files.filter((f) => !before.has(lower(f.name))).map((f) => f.name);
    const removed = item.files.filter((f) => !after.has(lower(f.name))).map((f) => f.name);
    const changed = d.files.filter((f) => before.has(lower(f.name)) && before.get(lower(f.name))!.content !== f.content && !f.path).map((f) => f.name);
    if (added.length) changes.push(`files added: ${added.join(", ")}`);
    if (changed.length) changes.push(`files changed: ${changed.join(", ")}`);
    if (removed.length) changes.push(`files removed: ${removed.join(", ")}`);
  }
  const appsChanged = appsLabel(d.apps) !== appsLabel(item.apps);
  if (appsChanged) changes.push(`works in: ${appsLabel(item.apps) || "(none)"} → ${appsLabel(d.apps)}`);
  if (d.audiences.join("|") !== item.audiences.join("|")) changes.push(`teams: ${item.audiences.join(", ")} → ${d.audiences.join(", ")}`);
  if (JSON.stringify(d.links) !== JSON.stringify(item.links)) changes.push(`links: ${item.links.length} → ${d.links.length} (${d.links.map((l) => l.url).join(", ") || "none"})`);
  if (d.visibility !== item.visibility) {
    changes.push(`visibility: ${item.visibility} → ${d.visibility}${d.visibility === "public" ? " (everyone at Clay will be able to find it)" : " (only the owner and editors will see it)"}`);
  }
  if (addEditors.length) changes.push(`editors added: ${addEditors.join(", ")}`);
  if (removeEditors.length) changes.push(`editors removed: ${removeEditors.join(", ")}`);

  warnings.push(...qualityNotes(d));
  return { ok: true, item, draft: d, changes, warnings, addEditors, removeEditors, appsChanged };
}

export function editPreviewText(lib: Library, p: PreparedEdit): string {
  if (!p.ok || !p.draft || !p.item) return `Can't make this change: ${p.error}${p.warnings.length ? `\n\n${p.warnings.map((w) => `- ${w}`).join("\n")}` : ""}`;
  if (!p.changes.length) return `Nothing would change on "${p.item.title}". ${lib.origin}/prompts/${p.item.id}`;
  const lines = [`## Changes to "${p.item.title}"`, ...p.changes.map((c) => `- ${c}`)];
  if (p.draft.kind === "prompt" && p.draft.body !== p.item.body) {
    lines.push(`\n### New prompt text\n${p.draft.body.length > 3000 ? `${p.draft.body.slice(0, 3000)}\n… (${p.draft.body.length} characters in total)` : p.draft.body}`);
  }
  if (p.warnings.length) lines.push(`\n### Worth fixing first\n${p.warnings.map((w) => `- ${w}`).join("\n")}`);
  lines.push(`\nbased on: ${p.item.updatedAt}`);
  lines.push("The previous version stays in the item's version history, so this can be undone on the site.");
  return lines.join("\n");
}

/** Apply a prepared edit as the connected person. */
export async function saveEdit(service: SupabaseClient, lib: Library, p: PreparedEdit, basedOn?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const item = p.item!;
  const d = p.draft!;
  const fresh = await service.from("prompts").select("updated_at").eq("id", item.id).maybeSingle();
  const current = (fresh.data as { updated_at: string } | null)?.updated_at;
  if (!current) return { ok: false, error: "That item no longer exists." };
  if (basedOn && new Date(current).getTime() !== new Date(basedOn).getTime()) {
    return { ok: false, error: "It was changed on the site since you previewed it. Call preview_changes again and show the person the new result." };
  }

  const { error } = await service
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
      last_edited_by: lib.me.id,
    })
    .eq("id", item.id);
  if (error) return { ok: false, error: error.message };

  if (p.appsChanged) {
    const del = await service.from("prompt_apps").delete().eq("prompt_id", item.id);
    if (del.error) return { ok: false, error: del.error.message };
    const ins = await service
      .from("prompt_apps")
      .insert(d.apps.map((a) => ({ prompt_id: item.id, app: a.app, surfaces: a.surfaces, model: a.model, model_required: a.required })));
    if (ins.error) return { ok: false, error: ins.error.message };
  }
  if (p.addEditors.length) {
    const r = await service.from("prompt_editors").insert(p.addEditors.map((e) => ({ prompt_id: item.id, email: e, added_by: lib.me.id })));
    if (r.error) return { ok: false, error: r.error.message };
  }
  if (p.removeEditors.length && item.ownerId === lib.me.id) {
    const r = await service.from("prompt_editors").delete().eq("prompt_id", item.id).in("email", p.removeEditors);
    if (r.error) return { ok: false, error: r.error.message };
  }
  try {
    revalidatePath("/");
    revalidatePath(`/prompts/${item.id}`);
  } catch {
    // Best-effort; pages are dynamic.
  }
  return { ok: true };
}
