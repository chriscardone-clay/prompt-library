/**
 * Validation for a new or edited prompt/skill, shared by the editor's Server
 * Actions (src/app/actions.ts) and the MCP connector's create tool, so both
 * enforce the same limits and catalog rules. Pure: no I/O.
 */
import { type Catalog, isKnownApp, isKnownTeam, surfacesOf } from "@/lib/catalog";
import { ALLOWED_EMAIL_DOMAIN, isVisibility, MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_TEXT_BYTES } from "@/lib/constants";
import { fileBytes, formatBytes, linkHost, skillMd } from "@/lib/skills";
import type { PromptApp, PromptDraft, SkillFile, SkillLink } from "@/lib/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const MAX_FILE_NAME = 160;
const MAX_LINKS = 20;

/**
 * Validate and tidy a draft. `allowedFolders` are the storage folders (prompt
 * ids) a binary file may point into: the prompt itself, and for forks the
 * parent it was copied from.
 */
const hasLinkInput = (input: PromptDraft) => (input.links ?? []).some((l) => String(l?.url ?? "").trim());

export function normaliseDraft(input: PromptDraft, allowedFolders: string[], catalog: Catalog): ActionResult<PromptDraft> {
  const kind = input.kind === "skill" ? "skill" : "prompt";
  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!title) return { ok: false, error: "Add a title." };
  if (title.length > 200) return { ok: false, error: "Title is too long (200 characters max)." };
  if (description.length > 600) return { ok: false, error: "Description is too long." };

  // Files belong to skills only. Links (where the item lives or is saved: a Granola
  // recipe, a Claude project, a custom GPT) are allowed on prompts and skills alike.
  let files: SkillFile[] = [];
  if (kind === "skill") {
    const seenNames = new Set<string>();
    let textBytes = 0;
    let totalBytes = 0;
    for (const f of input.files ?? []) {
      const name = String(f?.name ?? "")
        .trim()
        .replace(/^[/\\]+/, "")
        .replace(/\\/g, "/");
      if (!name) continue;
      if (name.split("/").some((seg) => seg === "..")) {
        return { ok: false, error: `File name "${name}" isn't allowed.` };
      }
      if (name.length > MAX_FILE_NAME) return { ok: false, error: "A file name is too long." };
      const key = name.toLowerCase();
      if (seenNames.has(key)) return { ok: false, error: `Two files are both named ${name}.` };
      seenNames.add(key);

      const path = typeof f?.path === "string" ? f.path.trim() : "";
      if (path) {
        // Binary file already uploaded to storage. It must sit in a folder this prompt may use.
        const folder = path.split("/")[0];
        if (!allowedFolders.includes(folder) || path.split("/").some((seg) => seg === "..")) {
          return { ok: false, error: `Stored file "${name}" doesn't belong to this skill.` };
        }
        const size = typeof f.size === "number" && Number.isFinite(f.size) && f.size >= 0 ? Math.floor(f.size) : 0;
        if (size > MAX_SKILL_BYTES) return { ok: false, error: `"${name}" is larger than ${formatBytes(MAX_SKILL_BYTES)}.` };
        const type = typeof f.type === "string" ? f.type.slice(0, 100) : undefined;
        const entry: SkillFile = { name, content: "", path, size };
        if (type) entry.type = type;
        totalBytes += size;
        files.push(entry);
      } else {
        const content = String(f?.content ?? "").replace(/\r\n/g, "\n");
        const entry: SkillFile = { name, content };
        const bytes = fileBytes(entry);
        textBytes += bytes;
        totalBytes += bytes;
        files.push(entry);
      }
    }
    if (files.length > MAX_SKILL_FILES) return { ok: false, error: `A skill can hold up to ${MAX_SKILL_FILES} files.` };
    if (textBytes > MAX_SKILL_TEXT_BYTES) {
      return { ok: false, error: `Text files total ${formatBytes(textBytes)}; the limit is ${formatBytes(MAX_SKILL_TEXT_BYTES)}.` };
    }
    if (totalBytes > MAX_SKILL_BYTES) {
      return { ok: false, error: `The skill totals ${formatBytes(totalBytes)}; the limit is ${formatBytes(MAX_SKILL_BYTES)}.` };
    }

    if (!files.length && !hasLinkInput(input)) return { ok: false, error: "Add at least one file or link." };
  } else {
    files = [];
  }

  const links: SkillLink[] = [];
  for (const l of input.links ?? []) {
    const url = String(l?.url ?? "").trim();
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `"${url}" isn't a valid link.` };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "Links must start with http:// or https://." };
    }
    const label = String(l?.label ?? "").trim().slice(0, 120) || linkHost(url);
    links.push({ label, url });
  }
  if (links.length > MAX_LINKS) return { ok: false, error: `Up to ${MAX_LINKS} links per ${kind}.` };
  if (kind === "skill" && !files.length && !links.length) return { ok: false, error: "Add at least one file or link." };

  // For skills the body mirrors SKILL.md so search and history work unchanged.
  const body = kind === "skill" ? skillMd(files) : (input.body ?? "").replace(/\r\n/g, "\n");
  if (kind === "prompt" && !body.trim()) return { ok: false, error: "Add the prompt itself." };
  if (body.length > 50_000) return { ok: false, error: "Prompt is too long." };
  const notes = (input.notes ?? "").replace(/\r\n/g, "\n").trim();
  if (notes.length > 5000) return { ok: false, error: "Notes are too long (5000 characters max)." };

  const seen = new Set<string>();
  const apps: PromptApp[] = [];
  for (const a of input.apps ?? []) {
    const name = String(a?.app ?? "").trim();
    if (!isKnownApp(catalog, name) || seen.has(name)) continue;
    seen.add(name);
    const allowed = surfacesOf(catalog, name);
    const model = String(a.model ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    apps.push({ app: name, surfaces: (a.surfaces ?? []).filter((s) => allowed.includes(s)), model, required: !!model && !!a.required });
  }
  if (!apps.length) return { ok: false, error: "Pick at least one tool." };

  const audiences = Array.from(
    new Set((input.audiences ?? []).map((t) => String(t ?? "").trim()).filter((t) => isKnownTeam(catalog, t))),
  );
  if (!audiences.length) return { ok: false, error: "Pick at least one team." };
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
      kind,
      title,
      description,
      body,
      notes,
      files,
      links,
      apps,
      audiences,
      visibility: input.visibility,
      forkNote: (input.forkNote ?? "").trim().slice(0, 600),
      editors,
    },
  };
}

