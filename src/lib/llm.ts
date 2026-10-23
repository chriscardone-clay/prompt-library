import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * Which model Ask AI and the Slack assistant talk to.
 *
 * - Self-hosted (LLM_BASE_URL set): any OpenAI-compatible server, e.g. the
 *   open-weight model in infra/modal/llm.py served by vLLM on Modal.
 *   LLM_API_KEY is its bearer key, LLM_MODEL the served model name.
 * - Otherwise: a model id on Vercel's AI Gateway (`fallbackId`).
 */
const BASE_URL = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "") || "";

const selfHosted = BASE_URL
  ? createOpenAICompatible({
      name: "self-hosted",
      baseURL: BASE_URL,
      apiKey: process.env.LLM_API_KEY?.trim() || undefined,
      // vLLM supports JSON-schema constrained output.
      supportsStructuredOutputs: true,
    })
  : null;

export const LLM_SELF_HOSTED = !!selfHosted;

/** A self-hosted model scales to zero, so the first request after idle waits for it to boot. */
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || (selfHosted ? 150_000 : 30_000);

export function chatModel(fallbackId: string): LanguageModel {
  return selfHosted ? selfHosted.chatModel(process.env.LLM_MODEL?.trim() || "llm") : fallbackId;
}

/** What to show and log as the model in use. */
export function modelLabel(fallbackId: string): string {
  return selfHosted ? `self-hosted:${process.env.LLM_MODEL?.trim() || "llm"}` : fallbackId;
}
