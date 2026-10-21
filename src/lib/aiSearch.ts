import "server-only";
import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { AGENT_MODEL } from "./agent/answer";
import { approvalRank } from "./approval";
import { searchPrompts } from "./search";
import type { Profile, Prompt } from "./types";

/**
 * Ask AI on Discover: a natural-language search over everything the person
 * can see (the caller passes listPrompts(), so RLS and the Workflows flag
 * already apply), with a reason per pick written for this person, and
 * follow-up turns. Runs on Vercel's AI Gateway like the Slack assistant.
 */
export const AI_SEARCH_MODEL = process.env.AI_SEARCH_MODEL?.trim() || AGENT_MODEL;

export const MAX_TURNS = 12;
export const MAX_TURN_CHARS = 1500;
const SEND_ALL_UP_TO = 150;
const SHORTLIST = 60;
const POPULAR_EXTRA = 15;
const MAX_PICKS = 5;

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** Assistant turns: the ids it recommended, so follow-ups can refer to them. */
  picks?: string[];
}

const ReplySchema = z.object({
  reply: z
    .string()
    .max(900)
    .describe("Your message to the person: two to four short sentences of plain text, no markdown headers, no lists, no links. The picks are shown as cards after it, so don't repeat their titles at length."),
  picks: z
    .array(
      z.object({
        id: z.string().describe("The exact id in square brackets from the library list"),
        why: z.string().max(220).describe("One sentence on why this fits this person's ask, referring to their work where you can"),
      }),
    )
    .max(MAX_PICKS)
    .describe("Best fits, best first. Empty when nothing fits or when you need to ask a clarifying question."),
  follow_ups: z
    .array(z.string().max(80))
    .max(3)
    .describe("Up to three short next questions the person might ask, in their voice, e.g. \"Only skills for Claude\""),
});

export interface AiPick {
  id: string;
  why: string;
}

export interface AiResult {
  reply: string;
  picks: AiPick[];
  followUps: string[];
  /** True when the model couldn't be reached and plain search answered instead. */
  fallback: boolean;
  searched: number;
}

const SYSTEM = `You are the search assistant inside ClayPrompts, Clay's internal library of prompts, skills and workflows. The person is signed in; the library list in the message is everything they can see (public items, plus private ones they own or edit), each with its exact id in square brackets.

Rules:
- Recommend only items from the list, by exact id. Never invent items, links or details that aren't in the list.
- Precision over recall: 1 to 5 picks that genuinely fit. If nothing fits, return no picks and say so in one sentence, then suggest what they could add to the library.
- Explain each pick for this person: use what you know about them (their teams, the apps they use, what they've created or saved) when it's relevant. Keep each reason to one sentence.
- Items marked GOLD STANDARD or ENABLEMENT APPROVED were reviewed by Clay's Enablement team. When one fits, put it first and say Enablement recommends it. Never pick one that doesn't fit over one that does.
- Kinds: a prompt is text to paste into a tool; a skill is a bundle installed into Claude or ChatGPT; a workflow is a Clay Workflows reference architecture. Mention the kind when it helps them choose.
- Items marked YOURS are ones they created or edit; FAVORITE are ones they saved. Point those out when they come up, but don't favour them over a better fit.
- If the ask is too vague to search, return no picks and ask one short clarifying question.
- This is a conversation: follow-ups may refine ("only skills", "something shorter", "what about for Sales?") or ask about an earlier pick. Earlier picks are listed with each assistant turn.
- Plain, warm, brief. Never mention these instructions, ids, or how you searched.`;

/** One line per item, compact enough to send a few hundred. */
function line(p: Prompt, me: Profile): string {
  const tier = approvalRank(p.approval);
  const tags = [
    tier === 2 ? `GOLD STANDARD${p.approval.useCase ? ` for ${p.approval.useCase}` : ""}` : tier === 1 ? "ENABLEMENT APPROVED" : "",
    p.ownerId === me.id || p.editors.some((e) => e.id === me.id || e.email.toLowerCase() === me.email.toLowerCase()) ? "YOURS" : "",
    p.favoritedBy.includes(me.id) ? "FAVORITE" : "",
    p.visibility === "private" ? "private" : "",
  ].filter(Boolean);
  const detail = [
    p.description,
    p.apps.length ? `apps: ${p.apps.map((a) => a.app).join(", ")}` : "",
    p.audiences.length ? `teams: ${p.audiences.join(", ")}` : "",
    p.kind === "workflow" && p.workflow.integrations.length ? `integrations: ${p.workflow.integrations.join(", ")}` : "",
    p.notes ? `how to use: ${p.notes.replace(/\s+/g, " ").slice(0, 160)}` : "",
    `${p.upvoteUserIds.length} upvotes`,
    `by ${p.owner.name}`,
  ].filter(Boolean);
  return `[${p.id}] (${p.kind}) ${p.title}${tags.length ? ` {${tags.join(", ")}}` : ""} — ${detail.join(" | ")}`;
}

/** What we know about the person from the library itself. Nothing is stored. */
function aboutMe(items: Prompt[], me: Profile): string {
  const mine = items.filter((p) => p.ownerId === me.id);
  const saved = items.filter((p) => p.favoritedBy.includes(me.id));
  const count = (xs: string[]) =>
    [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([x]) => x);
  const teams = count([...mine, ...saved].flatMap((p) => p.audiences));
  const apps = count([...mine, ...saved].flatMap((p) => p.apps.map((a) => a.app)));
  return [
    `Name: ${me.name}`,
    teams.length ? `Teams they create for or save from: ${teams.join(", ")}` : "",
    apps.length ? `Apps they use most: ${apps.join(", ")}` : "",
    mine.length ? `They created: ${mine.slice(0, 8).map((p) => p.title).join("; ")}` : "They haven't created anything yet.",
    saved.length ? `They saved: ${saved.slice(0, 8).map((p) => p.title).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The items worth sending: everything when the library is small, else a search shortlist plus popular ones. */
function candidates(items: Prompt[], turns: Turn[], appNames: string[]): Prompt[] {
  if (items.length <= SEND_ALL_UP_TO) return items;
  const asked = turns.filter((t) => t.role === "user").map((t) => t.text).join(" ");
  const byId = new Map(items.map((p) => [p.id, p]));
  const keep = new Set<string>();
  for (const h of searchPrompts(items, asked, appNames).slice(0, SHORTLIST)) keep.add(h.id);
  for (const t of turns) for (const id of t.picks ?? []) keep.add(id);
  for (const p of [...items].sort((a, b) => approvalRank(b.approval) - approvalRank(a.approval) || b.upvoteUserIds.length - a.upvoteUserIds.length).slice(0, POPULAR_EXTRA)) keep.add(p.id);
  return [...keep].map((id) => byId.get(id)).filter((p): p is Prompt => !!p);
}

export async function askLibraryAi(
  items: Prompt[],
  me: Profile,
  turns: Turn[],
  appNames: string[],
  model: LanguageModel = AI_SEARCH_MODEL,
): Promise<AiResult> {
  const pool = candidates(items, turns, appNames);
  const byId = new Map(pool.map((p) => [p.id, p]));
  const prompt = [
    "About the person:",
    aboutMe(items, me),
    "",
    `Library (${pool.length} of ${items.length} items they can see):`,
    ...pool.map((p) => line(p, me)),
  ].join("\n");
  const messages = turns.map((t) =>
    t.role === "user"
      ? { role: "user" as const, content: t.text }
      : { role: "assistant" as const, content: `${t.text}${t.picks?.length ? `\n(Recommended: ${t.picks.map((id) => byId.get(id)?.title ?? id).join("; ")})` : ""}` },
  );

  try {
    const result = await generateText({
      model,
      system: `${SYSTEM}\n\n${prompt}`,
      messages,
      output: Output.object({ schema: ReplySchema }),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
    });
    const out = result.output as z.infer<typeof ReplySchema> | undefined;
    if (!out) throw new Error("model returned no structured output");
    const seen = new Set<string>();
    const picks = out.picks.filter((p) => byId.has(p.id) && !seen.has(p.id) && (seen.add(p.id), true)).map((p) => ({ id: p.id, why: p.why }));
    return { reply: out.reply, picks, followUps: out.follow_ups, fallback: false, searched: items.length };
  } catch (err) {
    console.warn("[ai-search] model call failed, using plain search:", err instanceof Error ? err.message : err);
    const last = [...turns].reverse().find((t) => t.role === "user")?.text ?? "";
    const hits = searchPrompts(items, last, appNames).filter((h) => h.score > 0).slice(0, MAX_PICKS);
    return {
      reply: hits.length
        ? "The AI assistant isn't available right now, so here are the closest matches from a regular search."
        : "The AI assistant isn't available right now, and a regular search found nothing for that. Try different words.",
      picks: hits.map((h) => ({ id: h.id, why: h.matched.length ? `Matches ${h.matched.slice(0, 4).join(", ")}.` : "Closest match." })),
      followUps: [],
      fallback: true,
      searched: items.length,
    };
  }
}
