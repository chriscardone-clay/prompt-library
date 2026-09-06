/**
 * In-app search ranking. The same idea as the Slack assistant's Postgres
 * search (`search_library`), ported to run instantly in the browser on the
 * items already loaded: each content word scores by the best field it appears
 * in (title 1.0, description 0.5, notes/apps/teams 0.3, body 0.1), averaged
 * over the words, plus an all-words bonus, synonym coverage, and fuzzy title
 * similarity. Substring matches on the title or description always count, so
 * typing "cla" still narrows to Clay items as you type.
 *
 * For skills the body mirrors SKILL.md, so that is the only file content read.
 */
import { parseIntent } from "./agent/lexical";
import { skillMd } from "./skills";
import type { Prompt } from "./types";

export interface SearchHit {
  id: string;
  score: number;
  matched: string[];
}

const MIN_SCORE = 0.3;
const RELATIVE_FLOOR = 0.45;

/** Crude English stemmer: enough to make "audits" meet "audit" and "recaps" meet "recap". */
export function stem(w: string): string {
  let s = w.toLowerCase();
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && (s.endsWith("es") || s.endsWith("ed"))) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9'-]+/)) {
    const w = t.replace(/^['-]+|['-]+$/g, "");
    if (w.length > 1) out.add(stem(w));
  }
  return out;
}

/** Does the field contain the word (by stem, or by a 4+ character prefix either way)? */
function has(field: Set<string>, word: string): boolean {
  const s = stem(word);
  if (field.has(s)) return true;
  if (s.length < 4) return false;
  for (const t of field) {
    if (t.length >= 4 && (t.startsWith(s) || s.startsWith(t))) return true;
  }
  return false;
}

function trigrams(s: string): Set<string> {
  const p = `  ${s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** How much of `needle` appears in `hay` (like pg_trgm's word_similarity). */
function coverage(needle: string, hay: string): number {
  const a = trigrams(needle);
  if (!a.size) return 0;
  const b = trigrams(hay);
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return n / a.size;
}

interface Doc {
  title: Set<string>;
  desc: Set<string>;
  meta: Set<string>;
  body: Set<string>;
}

function docFor(p: Prompt): Doc {
  return {
    title: tokens(p.title),
    desc: tokens(p.description),
    meta: tokens([p.notes, ...p.apps.map((a) => `${a.app} ${a.surfaces.join(" ")}`), ...p.audiences].join(" ")),
    // Prompts: the prompt text. Skills: SKILL.md (or the first file), not every bundled file. Capped like the SQL version.
    body: tokens((p.kind === "skill" ? skillMd(p.files) || p.body : p.body).slice(0, 8000)),
  };
}

function fieldWeight(d: Doc, word: string): number {
  if (has(d.title, word)) return 1;
  if (has(d.desc, word)) return 0.5;
  if (has(d.meta, word)) return 0.3;
  if (has(d.body, word)) return 0.1;
  return 0;
}

/**
 * Rank items for a query. Returns only items worth showing, best first.
 * `appNames` lets "granola" or "claude" in the query boost items for that app.
 */
export function searchPrompts(prompts: Prompt[], query: string, appNames: string[]): SearchHit[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return prompts.map((p) => ({ id: p.id, score: 0, matched: [] }));
  const intent = parseIntent(raw, appNames);
  const rawCompact = raw.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  const hits: SearchHit[] = [];
  for (const p of prompts) {
    const d = docFor(p);
    const title = p.title.toLowerCase();
    const desc = p.description.toLowerCase();

    // Literal substring on title/description: always a hit, strongest when it's the title.
    const literal = title.includes(rawCompact) ? 1.2 : desc.includes(rawCompact) ? 0.7 : 0;

    let wordScore = 0;
    let allOutsideBody = intent.words.length > 0;
    const matched: string[] = [];
    if (intent.words.length) {
      let sum = 0;
      for (const w of intent.words) {
        const wt = fieldWeight(d, w);
        sum += wt;
        if (wt > 0) matched.push(w);
        if (wt < 0.3) allOutsideBody = false;
      }
      wordScore = sum / intent.words.length;
    }
    let extraScore = 0;
    if (intent.extra.length) {
      let sum = 0;
      for (const w of intent.extra) sum += fieldWeight(d, w);
      extraScore = sum / intent.extra.length;
    }
    const titleSim = Math.max(coverage(intent.query || rawCompact, title), coverage(title, rawCompact) * 0.9);
    const kindBoost = intent.kind && p.kind === intent.kind ? 0.1 : 0;
    const appBoost = intent.apps.length && p.apps.some((a) => intent.apps.includes(a.app.toLowerCase())) ? 0.15 : 0;

    const score = literal + wordScore + (allOutsideBody ? 0.3 : 0) + 0.3 * extraScore + 0.35 * titleSim + kindBoost + appBoost;
    const strong = literal > 0 || matched.some((w) => fieldWeight(d, w) >= 0.5) || titleSim >= 0.4;
    if (score >= MIN_SCORE && strong) hits.push({ id: p.id, score, matched });
  }

  hits.sort((a, b) => b.score - a.score);
  const best = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= best * RELATIVE_FLOOR);
}
