import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A public library item, compacted for the model and for building replies. */
export interface Candidate {
  id: string;
  title: string;
  kind: "prompt" | "skill";
  description: string;
  notes: string;
  apps: string[];
  audiences: string[];
  updated_at: string;
  /** Full-text rank when the shortlist came from search; undefined when we sent everything. */
  rank?: number;
}

/** Above this many public items we shortlist with full-text search instead of sending all. */
const SEND_ALL_UP_TO = 150;
const SHORTLIST = 40;
const NEWEST_EXTRA = 12;

interface Row {
  id: string;
  title: string;
  kind: string | null;
  description: string | null;
  notes: string | null;
  audiences: string[] | null;
  updated_at: string;
  prompt_apps: { app: string }[] | null;
}

function toCandidate(r: Row): Candidate {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind === "skill" ? "skill" : "prompt",
    description: r.description ?? "",
    notes: (r.notes ?? "").slice(0, 400),
    apps: (r.prompt_apps ?? []).map((a) => a.app),
    audiences: r.audiences ?? [],
    updated_at: r.updated_at,
  };
}

const SELECT = "id, title, kind, description, notes, audiences, updated_at, prompt_apps ( app )";

/**
 * Items the model may choose from. Small libraries are sent whole; larger ones
 * are shortlisted by full-text search plus the newest items, so brand-new
 * additions are still discoverable when the question is vague.
 */
export async function loadCandidates(client: SupabaseClient, question: string): Promise<{ items: Candidate[]; total: number; shortlisted: boolean }> {
  const { count } = await client.from("prompts").select("id", { count: "exact", head: true }).eq("visibility", "public");
  const total = count ?? 0;

  if (total <= SEND_ALL_UP_TO) {
    const { data, error } = await client.from("prompts").select(SELECT).eq("visibility", "public").order("updated_at", { ascending: false });
    if (error) throw new Error(`loadCandidates: ${error.message}`);
    return { items: ((data ?? []) as unknown as Row[]).map(toCandidate), total, shortlisted: false };
  }

  const [hits, newest] = await Promise.all([
    client.rpc("search_public_prompts", { q: question, lim: SHORTLIST }),
    client.from("prompts").select(SELECT).eq("visibility", "public").order("created_at", { ascending: false }).limit(NEWEST_EXTRA),
  ]);
  const ranks = new Map<string, number>(((hits.data ?? []) as { id: string; rank: number }[]).map((h) => [h.id, h.rank]));
  const ids = [...ranks.keys()];
  const { data: hitRows } = ids.length ? await client.from("prompts").select(SELECT).in("id", ids) : { data: [] };
  const seen = new Set<string>();
  const items: Candidate[] = [];
  for (const r of [...((hitRows ?? []) as unknown as Row[]), ...((newest.data ?? []) as unknown as Row[])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const c = toCandidate(r);
    c.rank = ranks.get(r.id);
    items.push(c);
  }
  items.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
  return { items, total, shortlisted: true };
}

/** Keyword ranking for when the model can't be reached. */
export async function keywordMatches(client: SupabaseClient, question: string, items: Candidate[], limit = 3): Promise<Candidate[]> {
  const { data } = await client.rpc("search_public_prompts", { q: question, lim: limit });
  const order = ((data ?? []) as { id: string }[]).map((h) => h.id);
  const byId = new Map(items.map((c) => [c.id, c]));
  return order.map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
}

/** One line per item, the way the model sees the library. */
export function describeCandidates(items: Candidate[]): string {
  return items
    .map((c, i) => {
      const bits = [c.kind === "skill" ? "Skill" : "Prompt", c.apps.length ? `for ${c.apps.join(", ")}` : null, c.audiences.length ? `teams: ${c.audiences.join(", ")}` : null].filter(Boolean);
      const notes = c.notes ? ` Notes: ${c.notes.replace(/\s+/g, " ").slice(0, 240)}` : "";
      return `${i + 1}. [${c.id}] ${c.title} — ${bits.join(" · ")}. ${c.description.replace(/\s+/g, " ")}${notes}`;
    })
    .join("\n");
}
