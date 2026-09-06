import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/site";
import type { SlackMessage } from "@/lib/slack";
import { AGENT_MODEL, type AnswerResult, answerQuestion, type ThreadContext } from "./answer";
import { lexicalMatches, loadCandidates } from "./catalog";
import { parseIntent } from "./lexical";
import { buildReplyMessage } from "./reply";

export interface Ask {
  source: "mention" | "dm" | "admin-test";
  /** What the person wrote in the message that mentioned us (mentions stripped). */
  question: string;
  /** Earlier messages when the mention came from inside a thread. */
  thread?: ThreadContext;
  askerName?: string;
  eventId?: string;
  slackUser?: string;
  channel?: string;
  threadTs?: string;
}

export interface Handled {
  result: AnswerResult;
  message: SlackMessage;
  candidates: number;
  shortlisted: boolean;
  /** The text the search actually ran on (direct ask, or the thread's root when the ask was vague). */
  effectiveQuestion: string;
  clarified: boolean;
}

/** A vague mention inside a thread ("what do you have?") needs the thread to mean anything. */
const MIN_DIRECT_WORDS = 2;
/** Beyond this many other messages we don't try to guess what a vague mention refers to. */
const MAX_THREAD_FOR_GUESS = 5;

const CLARIFY_REPLY =
  "I can't tell from this thread what you're after. Reply with the ask in one line, for example: *@Clay Prompt Library is there a skill for account audits?*";

/**
 * Work out what's actually being asked. Returns the text to search on, or
 * null when we should ask the person to restate the request.
 */
export function resolveQuestion(direct: string, thread: ThreadContext | undefined): { question: string; usedThread: boolean } | null {
  const directWords = parseIntent(direct, []).words;
  if (directWords.length >= MIN_DIRECT_WORDS || !thread) return { question: direct, usedThread: false };
  const rootWords = parseIntent(thread.root, []).words;
  if (rootWords.length >= 1 && thread.others.length <= MAX_THREAD_FOR_GUESS) {
    return { question: `${thread.root.trim()} ${direct.trim()}`.trim(), usedThread: true };
  }
  return null;
}

/** Everything except talking to Slack: load, answer, build the message, log it. */
export async function handleAsk(client: SupabaseClient, ask: Ask): Promise<Handled> {
  const resolved = resolveQuestion(ask.question, ask.thread);

  let result: AnswerResult;
  let candidates = 0;
  let shortlisted = false;
  let effectiveQuestion = ask.question;

  if (!resolved) {
    result = {
      answer: { clarify: true, matches: [], reply: CLARIFY_REPLY },
      matches: [],
      why: new Map(),
      model: AGENT_MODEL,
      fallback: false,
    };
  } else {
    effectiveQuestion = resolved.question;
    const loaded = await loadCandidates(client, effectiveQuestion);
    candidates = loaded.items.length;
    shortlisted = loaded.shortlisted;
    result = await answerQuestion(ask.question, loaded.items, () => lexicalMatches(client, effectiveQuestion, loaded.items), {
      askerName: ask.askerName,
      thread: ask.thread,
    });
  }

  const message = buildReplyMessage(effectiveQuestion, result, getSiteUrl());
  await client.from("agent_requests").insert({
    source: ask.source,
    event_id: ask.eventId ?? null,
    slack_user: ask.slackUser ?? null,
    channel: ask.channel ?? null,
    thread_ts: ask.threadTs ?? null,
    question: (ask.thread ? `${ask.question}  ⟵ thread: ${ask.thread.root}` : ask.question).slice(0, 2000),
    matched_ids: result.matches.map((c) => c.id),
    reply: result.answer.reply,
    model: result.model,
    fallback: result.fallback,
    error: result.error ?? null,
  });
  return { result, message, candidates, shortlisted, effectiveQuestion, clarified: !!result.answer.clarify };
}

/** "<@U123> find me a recap prompt" → "find me a recap prompt" */
export function stripMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, " ")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/\s+/g, " ")
    .trim();
}
