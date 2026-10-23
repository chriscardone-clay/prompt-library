import "server-only";
import { approvalBoost, approvalRank, compareOutdated, isOutdated } from "@/lib/approval";
import { searchPrompts } from "@/lib/search";
import type { Prompt } from "@/lib/types";
import { type Library, popularity, relationTo } from "./library";

/**
 * "What prompts and skills am I missing out on?"
 *
 * The connector never sees Claude's memory. Claude summarises what it knows
 * about the person (role, team, recurring work, tools, goals) and passes that
 * profile in; we rank the library against each part of it, skip what the
 * person already has, and say which part of their work each pick serves.
 * The profile is used for this one call and not stored.
 */

export interface AboutMe {
  role?: string;
  team?: string;
  recurring_work?: string[];
  goals?: string[];
  pain_points?: string[];
  tools?: string[];
  already_using?: string[];
}

export interface Recommendation {
  item: Prompt;
  score: number;
  why: string;
}

export interface RecommendResult {
  picks: Recommendation[];
  /** Parts of the person's work nothing in the library covers yet. */
  gaps: string[];
  /** Items skipped because the person already owns, favorited or upvoted them, or said they use them. */
  skipped: { item: Prompt; reason: string }[];
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Does a title the person mentioned ("call recap prompt") name this item? */
function namesItem(mention: string, p: Prompt): boolean {
  const m = norm(mention).replace(/\b(prompt|skill)s?\b/g, "").trim();
  const t = norm(p.title);
  if (!m || m.length < 4) return false;
  if (t.includes(m) || m.includes(t)) return true;
  const mw = new Set(m.split(" ").filter((w) => w.length > 2));
  const tw = t.split(" ").filter((w) => w.length > 2);
  if (!tw.length || !mw.size) return false;
  const shared = tw.filter((w) => mw.has(w)).length;
  return shared / tw.length >= 0.75 && shared / mw.size >= 0.6;
}

/** The item's team that matches the person's ("GTM Engineering" ~ "GTME"), if any. */
function matchingTeam(team: string | undefined, p: Prompt): string | undefined {
  if (!team?.trim()) return undefined;
  const t = norm(team);
  return p.audiences.find((a) => {
    const n = norm(a);
    return n === t || (n.length >= 3 && t.includes(n)) || (t.length >= 3 && n.includes(t));
  });
}

function teamMatches(team: string | undefined, p: Prompt): boolean {
  return matchingTeam(team, p) !== undefined;
}

export function recommend(lib: Library, about: AboutMe, limit: number): RecommendResult {
  const appNames = lib.catalog.apps.map((a) => a.name);
  const tools = (about.tools ?? []).map(norm).filter(Boolean);
  const usesApp = (p: Prompt) => tools.length > 0 && p.apps.some((a) => tools.some((t) => t.includes(norm(a.app)) || norm(a.app).includes(t)));

  // Each facet is something the person does or wants; the role is a weaker facet.
  const facets: { text: string; label: string; weight: number }[] = [];
  for (const w of about.recurring_work ?? []) if (w.trim()) facets.push({ text: w, label: w.trim(), weight: 1 });
  for (const g of about.goals ?? []) if (g.trim()) facets.push({ text: g, label: g.trim(), weight: 0.9 });
  for (const pp of about.pain_points ?? []) if (pp.trim()) facets.push({ text: pp, label: pp.trim(), weight: 0.9 });
  if (about.role?.trim()) facets.push({ text: about.role, label: `your role (${about.role.trim()})`, weight: 0.6 });

  // What they already have: theirs, saved, upvoted, or named as in use.
  const skipped: RecommendResult["skipped"] = [];
  const pool: Prompt[] = [];
  for (const p of lib.items) {
    const rel = relationTo(lib, p);
    const named = (about.already_using ?? []).find((m) => namesItem(m, p));
    if (rel.length) skipped.push({ item: p, reason: rel.join(", ") });
    else if (named) skipped.push({ item: p, reason: `you said you already use "${named.trim()}"` });
    else pool.push(p);
  }

  const best = new Map<string, { score: number; facets: string[]; matched: Set<string> }>();
  const gaps: string[] = [];
  for (const f of facets) {
    const hits = searchPrompts(pool, f.text, appNames).slice(0, 8);
    if (!hits.length) {
      if (f.weight >= 0.9) gaps.push(f.label);
      continue;
    }
    const top = hits[0].score;
    for (const h of hits) {
      // Normalise within the facet so one wordy facet doesn't drown the others.
      const s = (h.score / top) * f.weight * Math.min(1, top);
      const cur = best.get(h.id) ?? { score: 0, facets: [], matched: new Set<string>() };
      cur.score = Math.max(cur.score, s) + (cur.facets.length ? 0.1 : 0);
      cur.facets.push(f.label);
      for (const w of h.matched) cur.matched.add(w);
      best.set(h.id, cur);
    }
  }

  const byId = new Map(pool.map((p) => [p.id, p]));
  const picks: Recommendation[] = [];
  for (const [id, b] of best) {
    const p = byId.get(id)!;
    let score = b.score;
    const reasons = [`fits ${b.facets.slice(0, 2).map((x) => `"${x}"`).join(" and ")}`];
    const team = matchingTeam(about.team, p);
    if (team) {
      score += 0.15;
      reasons.push(`made for ${team}`);
    }
    if (usesApp(p)) {
      score += 0.1;
      reasons.push(`works in ${p.apps.map((a) => a.app).filter((a) => tools.some((t) => t.includes(norm(a)) || norm(a).includes(t))).join(", ")}, which you use`);
    } else if (tools.length && p.apps.length) {
      score -= 0.1;
    }
    if (approvalRank(p.approval) === 2) reasons.push(`the gold standard${p.approval.useCase ? ` for ${p.approval.useCase}` : ""}`);
    else if (approvalRank(p.approval) === 1) reasons.push("Enablement approved");
    if (isOutdated(p)) reasons.push("but Enablement flagged it as outdated");
    score += approvalBoost(p.approval);
    score += 0.03 * Math.log1p(popularity(p));
    picks.push({ item: p, score, why: reasons.join("; ") });
  }
  picks.sort((a, b) => compareOutdated(a.item, b.item) || b.score - a.score);
  const chosen = picks.slice(0, limit);

  // Thin profile or thin matches: fill with what their team (or everyone) uses most.
  if (chosen.length < Math.min(limit, 5)) {
    const taken = new Set(chosen.map((c) => c.item.id));
    const popular = pool
      .filter((p) => !taken.has(p.id) && popularity(p) > 0 && !isOutdated(p))
      .sort((a, b) => Number(teamMatches(about.team, b)) - Number(teamMatches(about.team, a)) || popularity(b) - popularity(a));
    for (const p of popular) {
      if (chosen.length >= Math.min(limit, 5)) break;
      const team = teamMatches(about.team, p) ? `popular with ${about.team!.trim()}` : "one of the most-used items in the library";
      chosen.push({ item: p, score: 0, why: `${team} (${p.upvoteUserIds.length} upvotes, ${p.favoritedBy.length} favorites)` });
    }
  }

  return { picks: chosen, gaps, skipped };
}
