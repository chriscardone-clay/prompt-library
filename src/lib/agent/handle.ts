import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/site";
import type { SlackMessage } from "@/lib/slack";
import { answerQuestion, type AnswerResult } from "./answer";
import { keywordMatches, loadCandidates } from "./catalog";
import { buildReplyMessage } from "./reply";

export interface Ask {
  source: "mention" | "dm" | "admin-test";
  question: string;
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
}

/** Everything except talking to Slack: load, answer, build the message, log it. */
export async function handleAsk(client: SupabaseClient, ask: Ask): Promise<Handled> {
  const { items, shortlisted } = await loadCandidates(client, ask.question);
  const result = await answerQuestion(ask.question, items, () => keywordMatches(client, ask.question, items), { askerName: ask.askerName });
  const message = buildReplyMessage(ask.question, result, getSiteUrl());
  await client.from("agent_requests").insert({
    source: ask.source,
    event_id: ask.eventId ?? null,
    slack_user: ask.slackUser ?? null,
    channel: ask.channel ?? null,
    thread_ts: ask.threadTs ?? null,
    question: ask.question.slice(0, 2000),
    matched_ids: result.matches.map((c) => c.id),
    reply: result.answer.reply,
    model: result.model,
    fallback: result.fallback,
    error: result.error ?? null,
  });
  return { result, message, candidates: items.length, shortlisted };
}

/** "<@U123> find me a recap prompt" → "find me a recap prompt" */
export function stripMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, " ")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/\s+/g, " ")
    .trim();
}
