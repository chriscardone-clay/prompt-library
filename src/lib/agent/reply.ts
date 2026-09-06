import type { SlackMessage } from "@/lib/slack";
import { clip, esc } from "@/lib/digest/blocks";
import type { AnswerResult } from "./answer";

/** Build the Slack message for an answer: the reply, up to three item cards, and where to add more. */
export function buildReplyMessage(question: string, result: AnswerResult, siteUrl: string): SlackMessage {
  const site = siteUrl.replace(/\/$/, "");
  const blocks: Record<string, unknown>[] = [];

  blocks.push({ type: "section", text: { type: "mrkdwn", text: result.answer.reply.trim() } });

  // A clarification is just the question back; no cards, no nudges.
  if (result.answer.clarify) return { blocks, text: result.answer.reply };

  for (const c of result.matches) {
    const url = `${site}/prompts/${c.id}`;
    const kind = c.kind === "skill" ? "Skill" : "Prompt";
    const bits = [kind, c.apps.length ? esc(c.apps.join(", ")) : null].filter(Boolean).join(" · ");
    const why = result.why.get(c.id);
    const lines = [`*<${url}|${esc(c.title)}>* · ${bits}`, c.description ? esc(clip(c.description, 160)) : "", why ? `_${esc(why)}_` : ""].filter(Boolean);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
      accessory: { type: "button", text: { type: "plain_text", text: c.kind === "skill" ? "Open skill" : "Open prompt" }, url, action_id: `open_${c.id.slice(0, 8)}` },
    });
  }

  const search = `${site}/?q=${encodeURIComponent(question.trim().slice(0, 80))}`;
  const add = result.matches.length
    ? `Not quite it? <${search}|Search the library> · <${site}/prompts/new|Add a prompt> · <${site}/skills/new|Add a skill>`
    : `${result.answer.suggestion ? `Idea: *${esc(result.answer.suggestion)}* · ` : ""}<${site}/prompts/new|Add a prompt> · <${site}/skills/new|Add a skill> · <${search}|Search the library>`;
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: add }] });

  const text = [result.answer.reply, ...result.matches.map((c) => `${c.title}: ${site}/prompts/${c.id}`)].join(" ");
  return { blocks, text };
}
