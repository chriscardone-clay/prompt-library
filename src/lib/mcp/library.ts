import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Catalog, installFor } from "@/lib/catalog";
import { loadCatalog, PROMPT_SELECT, type PromptRow, toPrompt } from "@/lib/data";
import { parsePlaceholders } from "@/lib/placeholders";
import { searchPrompts } from "@/lib/search";
import { isBinaryFile, type Prompt } from "@/lib/types";
import type { McpUser } from "./oauth";

/**
 * What the MCP connector can read, as the person who connected it. The
 * connector reads with the service client, so this file is where RLS's rule
 * is re-applied: public items, plus private items the person owns or edits.
 * Favorites and upvotes are reduced to counts, except the person's own.
 */

export interface Library {
  items: Prompt[];
  catalog: Catalog;
  me: McpUser;
  origin: string;
}

export async function loadLibrary(service: SupabaseClient, me: McpUser, origin: string): Promise<Library> {
  // Linked editor rows match by profile id; the email only claims invites no one has linked yet.
  // Two plain filters rather than an .or() string, so nothing from the profile is parsed as filter syntax.
  const [linked, pending] = await Promise.all([
    service.from("prompt_editors").select("prompt_id").eq("profile_id", me.id),
    service.from("prompt_editors").select("prompt_id").eq("email", me.email).is("profile_id", null),
  ]);
  const editable = [...new Set([...(linked.data ?? []), ...(pending.data ?? [])].map((e) => (e as { prompt_id: string }).prompt_id))];
  const scope = [`visibility.eq.public`, `owner_id.eq.${me.id}`, ...(editable.length ? [`id.in.(${editable.join(",")})`] : [])];

  const [res, catalog] = await Promise.all([
    service.from("prompts").select(PROMPT_SELECT).or(scope.join(",")).order("updated_at", { ascending: false }),
    loadCatalog(service),
  ]);
  if (res.error) throw new Error(`loadLibrary: ${res.error.message}`);
  const items = ((res.data ?? []) as unknown as PromptRow[]).map(toPrompt);
  return { items, catalog, me, origin };
}

/** An editor row counts by its linked profile id; an unlinked invite counts by email. */
export function isEditor(p: Prompt, me: Pick<McpUser, "id" | "email">): boolean {
  return p.editors.some((e) => (e.id ? e.id === me.id : e.email === me.email));
}

export function itemUrl(lib: Library, p: Prompt): string {
  return `${lib.origin}/prompts/${p.id}`;
}

export function popularity(p: Prompt): number {
  return p.upvoteUserIds.length * 3 + p.favoritedBy.length * 2;
}

export function relationTo(lib: Library, p: Prompt): string[] {
  const out: string[] = [];
  if (p.ownerId === lib.me.id) out.push("you created it");
  else if (isEditor(p, lib.me)) out.push("you're an editor");
  if (p.favoritedBy.includes(lib.me.id)) out.push("in your favorites");
  if (p.upvoteUserIds.includes(lib.me.id)) out.push("you upvoted it");
  return out;
}

/** "Claude (Projects; recommended model Opus 4.6)" */
function appLine(p: Prompt): string {
  return p.apps
    .map((a) => {
      const bits = [a.surfaces.length ? a.surfaces.join(", ") : "", a.model ? `${a.required ? "requires" : "recommended model"} ${a.model}` : ""].filter(Boolean);
      return bits.length ? `${a.app} (${bits.join("; ")})` : a.app;
    })
    .join(", ");
}

/** A compact card: enough to choose, with the id to fetch the full thing. */
export function summarize(lib: Library, p: Prompt, why?: string): string {
  const lines = [
    `### ${p.title}`,
    `- id: ${p.id}`,
    `- kind: ${p.kind}${p.visibility === "private" ? " (private)" : ""}`,
    p.description ? `- description: ${p.description.replace(/\s+/g, " ")}` : "",
    p.apps.length ? `- works in: ${appLine(p)}` : "",
    p.audiences.length ? `- teams: ${p.audiences.join(", ")}` : "",
    `- by ${p.owner.name} · ${p.upvoteUserIds.length} upvotes · ${p.favoritedBy.length} favorites · updated ${p.updatedAt.slice(0, 10)}`,
  ];
  const placeholders = p.kind === "prompt" ? parsePlaceholders(p.body) : [];
  if (placeholders.length) lines.push(`- fill-ins: ${placeholders.join(", ")}`);
  const rel = relationTo(lib, p);
  if (rel.length) lines.push(`- you: ${rel.join(", ")}`);
  if (why) lines.push(`- why: ${why}`);
  lines.push(`- link: ${itemUrl(lib, p)}`);
  return lines.filter(Boolean).join("\n");
}

export interface Filters {
  kind?: "prompt" | "skill";
  app?: string;
  team?: string;
}

function eq(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function applyFilters(items: Prompt[], f: Filters): Prompt[] {
  return items.filter(
    (p) =>
      (!f.kind || p.kind === f.kind) &&
      (!f.app || p.apps.some((a) => eq(a.app, f.app!))) &&
      (!f.team || p.audiences.some((t) => eq(t, f.team!))),
  );
}

export function search(lib: Library, query: string, f: Filters, limit: number) {
  const pool = applyFilters(lib.items, f);
  const hits = searchPrompts(pool, query, lib.catalog.apps.map((a) => a.name));
  const byId = new Map(pool.map((p) => [p.id, p]));
  return hits.slice(0, limit).map((h) => ({ item: byId.get(h.id)!, matched: h.matched, score: h.score }));
}

export type Sort = "top" | "new" | "updated";

export function browse(lib: Library, f: Filters, sort: Sort, limit: number, offset: number) {
  const pool = applyFilters(lib.items, f);
  const sorted = [...pool].sort((a, b) =>
    sort === "top"
      ? popularity(b) - popularity(a) || b.updatedAt.localeCompare(a.updatedAt)
      : sort === "new"
        ? b.createdAt.localeCompare(a.createdAt)
        : b.updatedAt.localeCompare(a.updatedAt),
  );
  return { total: pool.length, page: sorted.slice(offset, offset + limit) };
}

export function findItem(lib: Library, id: string): Prompt | undefined {
  const key = id.trim();
  return lib.items.find((p) => p.id === key) ?? lib.items.find((p) => itemUrl(lib, p) === key || key.endsWith(`/prompts/${p.id}`));
}

/** How to put an item to work in each app it's built for, from the catalog. */
export function installNotes(lib: Library, p: Prompt): string[] {
  const out: string[] = [];
  for (const a of p.apps) {
    const surfaces = a.surfaces.length ? a.surfaces : [undefined];
    for (const s of surfaces) {
      const text = installFor(lib.catalog, a.app, s);
      if (text) out.push(`- ${a.app}${s ? ` · ${s}` : ""}: ${text.replace(/\s+/g, " ")}`);
    }
  }
  return [...new Set(out)];
}

/** Text files inline (capped so one skill can't flood the context), binaries listed by name. */
export function skillFiles(p: Prompt, maxChars = 120_000) {
  let used = 0;
  const text: { name: string; content: string; truncated: boolean }[] = [];
  const binary: string[] = [];
  const omitted: string[] = [];
  for (const f of p.files) {
    if (isBinaryFile(f)) {
      binary.push(f.name);
      continue;
    }
    if (used >= maxChars) {
      omitted.push(f.name);
      continue;
    }
    const room = maxChars - used;
    const truncated = f.content.length > room;
    const content = truncated ? f.content.slice(0, room) : f.content;
    used += content.length;
    text.push({ name: f.name, content, truncated });
  }
  return { text, binary, omitted };
}
