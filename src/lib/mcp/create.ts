import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { activeApps, activeTeams, isKnownApp, isKnownTeam } from "@/lib/catalog";
import { SKILL_TEMPLATE } from "@/lib/constants";
import { normaliseDraft } from "@/lib/draft";
import { parsePlaceholders } from "@/lib/placeholders";
import { searchPrompts } from "@/lib/search";
import { isSkillMd, parseFrontmatter } from "@/lib/skills";
import type { PromptDraft } from "@/lib/types";
import type { Library } from "./library";

/**
 * Saving a prompt or skill from a chat ("this went well, save it as a
 * prompt"). Validation is the editor's own (src/lib/draft.ts); on top of it
 * we warn about near-duplicates and names that aren't in the catalog, so the
 * assistant can fix them with the person before anything is saved.
 */

export const itemShape = {
  kind: z.enum(["prompt", "skill"]).describe("prompt = text people paste into a tool; skill = SKILL.md (+ optional reference files) installed into a tool"),
  title: z.string().min(1).max(200).describe("Short, searchable name of what it does, e.g. \"Discovery call prep brief\""),
  description: z.string().max(600).optional().describe("One or two sentences: what it produces and when to reach for it"),
  body: z
    .string()
    .max(50_000)
    .optional()
    .describe("Prompts: the prompt text, with the specifics from this session replaced by {{placeholders}} like {{company}}. Skills: SKILL.md content, if you don't pass files"),
  files: z
    .array(z.object({ name: z.string().min(1).max(160), content: z.string() }))
    .max(60)
    .optional()
    .describe("Skills only: text files, SKILL.md first (with name/description frontmatter), then any references or scripts"),
  notes: z.string().max(5000).optional().describe("How to use: when to use it, tips, connectors or inputs it needs. Lines starting with \"- \" become bullets"),
  apps: z
    .array(
      z.object({
        app: z.string().describe("Exact app name from the catalog, e.g. Claude, ChatGPT, Town"),
        surfaces: z.array(z.string()).optional().describe("Exact surface names for that app, e.g. Chat, Code; empty = any"),
        model: z.string().max(80).optional().describe("Model it works best with, e.g. \"Opus 4.6\""),
        model_required: z.boolean().optional().describe("true only if it doesn't work well on other models"),
      }),
    )
    .min(1)
    .describe("Where it works"),
  teams: z.array(z.string()).min(1).describe("Exact team names from the catalog it's for"),
  visibility: z.enum(["public", "private"]).describe("Ask the person. public = everyone at Clay can find it; private = only them and editors"),
  links: z.array(z.object({ label: z.string().max(120).optional(), url: z.string().url() })).max(20).optional().describe("Where it lives or is saved, e.g. a Claude project or custom GPT"),
  editors: z.array(z.string().email()).max(20).optional().describe("Teammates (@clay.com) who may edit it too"),
  forked_from: z
    .string()
    .optional()
    .describe("When this is the person's own version of a library item they can't edit (e.g. improved from this chat): that item's id. Saves it as a linked fork"),
  fork_note: z.string().max(200).optional().describe("With forked_from: what's different in this version, e.g. \"Shorter, adds a pricing section\""),
};
const itemSchema = z.object(itemShape);
export type ItemInput = z.infer<typeof itemSchema>;

export interface Prepared {
  ok: boolean;
  error?: string;
  draft?: PromptDraft;
  /** The item this is a fork of (forked_from), when it exists and the person can see it. */
  parent?: { id: string; title: string };
  warnings: string[];
  similar: { id: string; title: string; url: string }[];
}

function toDraft(input: ItemInput): PromptDraft {
  const files =
    input.kind === "skill"
      ? input.files?.length
        ? input.files
        : input.body?.trim()
          ? [{ name: "SKILL.md", content: input.body }]
          : []
      : [];
  return {
    kind: input.kind,
    title: input.title,
    description: input.description ?? "",
    body: input.kind === "prompt" ? (input.body ?? "") : "",
    notes: input.notes ?? "",
    files,
    links: (input.links ?? []).map((l) => ({ label: l.label ?? "", url: l.url })),
    apps: input.apps.map((a) => ({ app: a.app, surfaces: a.surfaces ?? [], model: a.model ?? "", required: !!a.model_required })),
    audiences: input.teams,
    visibility: input.visibility,
    forkNote: (input.fork_note ?? "").trim(),
    editors: input.editors ?? [],
  };
}

/** Case-insensitive catalog lookup, so "claude" becomes "Claude". */
function canonical<T extends { name: string }>(list: T[], name: string): string {
  return list.find((x) => x.name.toLowerCase() === name.trim().toLowerCase())?.name ?? name.trim();
}

type AppInput = ItemInput["apps"][number];

/** Fix casing against the catalog and say which apps, surfaces or teams don't exist (they get dropped). */
export function checkCatalog(lib: Library, rawApps: AppInput[] | undefined, rawTeams: string[] | undefined) {
  const warnings: string[] = [];
  const apps = rawApps?.map((a) => {
    const app = canonical(lib.catalog.apps, a.app);
    const surfaces = lib.catalog.apps.find((x) => x.name === app)?.surfaces ?? [];
    return { ...a, app, surfaces: (a.surfaces ?? []).map((s) => canonical(surfaces, s)) };
  });
  const teams = rawTeams?.map((t) => canonical(lib.catalog.teams, t));
  for (const a of apps ?? []) {
    if (!isKnownApp(lib.catalog, a.app)) warnings.push(`"${a.app}" isn't an app in the library and will be dropped. Apps: ${activeApps(lib.catalog).map((x) => x.name).join(", ")}.`);
    else {
      const known = lib.catalog.apps.find((x) => x.name === a.app)!.surfaces.map((s) => s.name);
      const bad = (a.surfaces ?? []).filter((s) => !known.includes(s));
      if (bad.length) warnings.push(`${a.app} has no surface ${bad.map((s) => `"${s}"`).join(", ")} (dropped). Its surfaces: ${known.join(", ") || "none"}.`);
    }
  }
  for (const t of teams ?? []) {
    if (!isKnownTeam(lib.catalog, t)) warnings.push(`"${t}" isn't a team in the library and will be dropped. Teams: ${activeTeams(lib.catalog).map((x) => x.name).join(", ")}.`);
  }
  return { apps, teams, warnings };
}

/** The editor's validation, with its error phrased for chat and the valid names attached. */
export function validate(lib: Library, draft: PromptDraft, folders: string[]) {
  const v = normaliseDraft(draft, folders, lib.catalog);
  if (v.ok) return v;
  const hint = /tool/.test(v.error)
    ? ` Apps: ${activeApps(lib.catalog).map((x) => x.name).join(", ")}.`
    : /team/.test(v.error)
      ? ` Teams: ${activeTeams(lib.catalog).map((x) => x.name).join(", ")}.`
      : "";
  return { ok: false as const, error: v.error.replace("Pick at least one tool.", "Pick at least one app it works in.") + hint };
}

/** Quality notes worth raising before saving: missing description, leftover specifics, SKILL.md without frontmatter. */
export function qualityNotes(d: PromptDraft): string[] {
  const warnings: string[] = [];
  if (!d.description) warnings.push("No description yet. One sentence on what it produces helps people find it.");
  if (d.kind === "prompt" && !parsePlaceholders(d.body).length && d.body.length > 200) {
    warnings.push("No {{placeholders}}. If the text still names a specific customer, person or deal from this session, swap those for {{company}}-style fill-ins so others can reuse it.");
  }
  if (d.kind === "skill") {
    const md = d.files.find((f) => isSkillMd(f.name));
    if (!md && d.files.length) warnings.push("No SKILL.md. Skills need one at the top level; the first file will be used instead.");
    else if (md && !parseFrontmatter(md.content).description) {
      warnings.push(`SKILL.md has no frontmatter description, which is how tools decide when to use the skill. Start it like:\n${SKILL_TEMPLATE.split("\n").slice(0, 4).join("\n")}`);
    }
  }
  return warnings;
}

/** Validate a draft and gather everything worth telling the person before saving. */
export function prepare(lib: Library, raw: ItemInput): Prepared {
  const checked = checkCatalog(lib, raw.apps, raw.teams);
  const warnings = checked.warnings;
  const input: ItemInput = { ...raw, apps: checked.apps!, teams: checked.teams! };

  const parentItem = raw.forked_from ? lib.items.find((x) => x.id === raw.forked_from!.trim() || raw.forked_from!.trim().endsWith(`/prompts/${x.id}`)) : undefined;
  if (raw.forked_from && !parentItem) return { ok: false, error: `No item ${raw.forked_from} that you can see to fork from.`, warnings, similar: [] };
  if (parentItem && parentItem.kind !== raw.kind) return { ok: false, error: `That item is a ${parentItem.kind}; save the fork as a ${parentItem.kind} too.`, warnings, similar: [] };
  const parent = parentItem ? { id: parentItem.id, title: parentItem.title } : undefined;

  const v = validate(lib, toDraft(input), []);
  if (!v.ok) return { ok: false, error: v.error, warnings, similar: [], parent };
  const d = v.data;
  warnings.push(...qualityNotes(d));

  const similar = searchPrompts(lib.items, `${d.title} ${d.description}`, lib.catalog.apps.map((a) => a.name))
    .filter((h) => h.score >= 0.9)
    .slice(0, 3)
    .map((h) => {
      const p = lib.items.find((x) => x.id === h.id)!;
      return { id: p.id, title: p.title, url: `${lib.origin}/prompts/${p.id}` };
    });

  // A fork is meant to resemble its parent; don't flag the parent as a duplicate.
  return { ok: true, draft: d, warnings, similar: similar.filter((x) => x.id !== parent?.id), parent };
}

/** What the saved item will look like, for the person to approve. */
export function previewText(p: Prepared): string {
  if (!p.ok || !p.draft) return `Can't save this yet: ${p.error}${p.warnings.length ? `\n\n${p.warnings.map((w) => `- ${w}`).join("\n")}` : ""}`;
  const d = p.draft;
  const lines = [
    `## Preview: ${d.title}`,
    `- kind: ${d.kind}`,
    `- visibility: ${d.visibility}${d.visibility === "public" ? " (everyone at Clay can find it)" : " (only you and editors)"}`,
    p.parent ? `- your version of: ${p.parent.title} (linked as a fork${d.forkNote ? `: ${d.forkNote}` : ""})` : "",
    d.description ? `- description: ${d.description}` : "",
    `- works in: ${d.apps.map((a) => `${a.app}${a.surfaces.length ? ` (${a.surfaces.join(", ")})` : ""}${a.model ? `, ${a.required ? "requires" : "recommended"} ${a.model}` : ""}`).join("; ")}`,
    `- teams: ${d.audiences.join(", ")}`,
    d.editors.length ? `- editors: ${d.editors.join(", ")}` : "",
    d.links.length ? `- links: ${d.links.map((l) => l.url).join(", ")}` : "",
    d.kind === "prompt" && parsePlaceholders(d.body).length ? `- fill-ins: ${parsePlaceholders(d.body).join(", ")}` : "",
    d.kind === "skill" ? `- files: ${d.files.map((f) => f.name).join(", ") || "none (link only)"}` : "",
    d.notes ? `\n### How to use\n${d.notes}` : "",
    d.kind === "prompt" ? `\n### Prompt\n${d.body.length > 3000 ? `${d.body.slice(0, 3000)}\n… (${d.body.length} characters in total)` : d.body}` : "",
  ];
  if (p.warnings.length) lines.push(`\n### Worth fixing first\n${p.warnings.map((w) => `- ${w}`).join("\n")}`);
  if (p.similar.length) {
    lines.push(`\n### Similar items already in the library\n${p.similar.map((s) => `- ${s.title}: ${s.url}`).join("\n")}\nIf one of these already does the job, suggest upvoting or forking it on the site instead.`);
  }
  return lines.filter(Boolean).join("\n");
}

const RECENT_DUPLICATE_MS = 15 * 60 * 1000;

/** Save as the connected person. Returns the new (or just-saved duplicate) item's id. */
export async function saveItem(service: SupabaseClient, lib: Library, p: Prepared): Promise<{ id: string; duplicate: boolean }> {
  const d = p.draft!;
  const me = lib.me;

  // Assistants sometimes retry a call; don't create the same thing twice.
  const recent = lib.items.find(
    (x) => x.ownerId === me.id && x.kind === d.kind && x.title.trim().toLowerCase() === d.title.toLowerCase() && Date.now() - new Date(x.createdAt).getTime() < RECENT_DUPLICATE_MS,
  );
  if (recent) return { id: recent.id, duplicate: true };

  const id = crypto.randomUUID();
  const { error } = await service.from("prompts").insert({
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
    owner_id: me.id,
    last_edited_by: me.id,
    parent_id: p.parent?.id ?? null,
    fork_note: p.parent ? d.forkNote : "",
  });
  if (error) throw new Error(`saveItem: ${error.message}`);
  const apps = await service
    .from("prompt_apps")
    .insert(d.apps.map((a) => ({ prompt_id: id, app: a.app, surfaces: a.surfaces, model: a.model, model_required: a.required })));
  if (apps.error) {
    await service.from("prompts").delete().eq("id", id);
    throw new Error(`saveItem apps: ${apps.error.message}`);
  }
  const editors = d.editors.filter((e) => e !== me.email);
  if (editors.length) {
    const ed = await service.from("prompt_editors").insert(editors.map((e) => ({ prompt_id: id, email: e, added_by: me.id })));
    if (ed.error) console.warn("[mcp] editors not added", ed.error.message);
  }
  try {
    revalidatePath("/");
    revalidatePath("/mine");
  } catch {
    // Pages are dynamic anyway; revalidation is best-effort outside a render.
  }
  return { id, duplicate: false };
}
