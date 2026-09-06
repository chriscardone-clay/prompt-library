import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Intent, parseIntent, suggestTitle } from "./lexical";

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
}

/** Above this many public items we shortlist with search instead of sending all. */
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

interface SearchHit {
  id: string;
  score: number;
  matched_words: string[];
  and_match: boolean;
  title_sim: number;
  best_weight: number;
}

async function appNames(client: SupabaseClient): Promise<string[]> {
  const { data } = await client.from("apps").select("name");
  return ((data ?? []) as { name: string }[]).map((a) => a.name);
}

async function runSearch(client: SupabaseClient, intent: Intent, raw: string, limit: number): Promise<SearchHit[]> {
  const { data, error } = await client.rpc("search_library", {
    p_words: intent.words,
    p_extra: intent.extra,
    p_query: intent.query,
    p_kind: intent.kind,
    p_apps: intent.apps,
    p_limit: limit,
    p_raw: raw.toLowerCase().replace(/[^a-z0-9 ]/g, " "),
  });
  if (error) throw new Error(`search_library: ${error.message}`);
  return (data ?? []) as SearchHit[];
}

/**
 * Items the model may choose from. Small libraries are sent whole; larger ones
 * are shortlisted by search plus the newest items, so brand-new additions are
 * still discoverable when the question is vague.
 */
export async function loadCandidates(client: SupabaseClient, question: string): Promise<{ items: Candidate[]; total: number; shortlisted: boolean }> {
  const { count } = await client.from("prompts").select("id", { count: "exact", head: true }).eq("visibility", "public");
  const total = count ?? 0;

  if (total <= SEND_ALL_UP_TO) {
    const { data, error } = await client.from("prompts").select(SELECT).eq("visibility", "public").order("updated_at", { ascending: false });
    if (error) throw new Error(`loadCandidates: ${error.message}`);
    return { items: ((data ?? []) as unknown as Row[]).map(toCandidate), total, shortlisted: false };
  }

  const intent = parseIntent(question, await appNames(client));
  const [hits, newest] = await Promise.all([
    runSearch(client, intent, question, SHORTLIST),
    client.from("prompts").select(SELECT).eq("visibility", "public").order("created_at", { ascending: false }).limit(NEWEST_EXTRA),
  ]);
  const order = new Map(hits.map((h, i) => [h.id, i]));
  const ids = [...order.keys()];
  const { data: hitRows } = ids.length ? await client.from("prompts").select(SELECT).in("id", ids) : { data: [] };
  const seen = new Set<string>();
  const items: Candidate[] = [];
  for (const r of [...((hitRows ?? []) as unknown as Row[]), ...((newest.data ?? []) as unknown as Row[])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    items.push(toCandidate(r));
  }
  items.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  return { items, total, shortlisted: true };
}

export interface LexicalMatch {
  candidate: Candidate;
  why: string;
  score: number;
}

export interface LexicalResult {
  matches: LexicalMatch[];
  intent: Intent;
  /** What we understood, for the reply ("recap customer call slack"). */
  understood: string;
  /** A title for the missing thing, when nothing matched. */
  suggestion?: string;
}

/** Confidence gates: strong enough on its own, and not far behind the best hit. */
const MIN_SCORE = 0.3;
const RELATIVE_FLOOR = 0.55;

/**
 * Non-AI answer: ranked lexical search with an explanation per hit. Used when
 * the model is unavailable, and as the shortlist for large libraries.
 */
export async function lexicalMatches(client: SupabaseClient, question: string, items: Candidate[], limit = 3): Promise<LexicalResult> {
  const intent = parseIntent(question, await appNames(client));
  const byId = new Map(items.map((c) => [c.id, c]));
  const hits = intent.words.length || intent.extra.length ? await runSearch(client, intent, question, 6) : [];
  const best = hits[0]?.score ?? 0;
  const matches: LexicalMatch[] = [];
  for (const h of hits) {
    const c = byId.get(h.id);
    if (!c) continue;
    const strong = h.best_weight >= 0.5 || h.title_sim >= 0.4;
    if (h.score < MIN_SCORE || h.score < best * RELATIVE_FLOOR || !strong) continue;
    const why = h.matched_words.length
      ? `Matches ${h.matched_words.slice(0, 4).join(", ")}${h.and_match ? " (all of your words)" : ""}`
      : h.title_sim >= 0.4
        ? "Close match on the title"
        : "Related by meaning";
    matches.push({ candidate: c, why, score: h.score });
    if (matches.length >= limit) break;
  }
  return { matches, intent, understood: intent.words.join(" "), suggestion: matches.length ? undefined : suggestTitle(intent) };
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
