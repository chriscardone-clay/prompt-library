import "server-only";
import { getSiteUrl } from "./site";
import { openSlackDm, postSlackMessage, slackConfigured, type SlackMessage } from "./slack";

/**
 * Slack messages for Enablement Approved. Best effort: a missing token, an
 * unknown email or a Slack error never fails the review itself.
 */

/** Optional channel (id, e.g. C0123…) that hears about new review requests. */
const CHANNEL = process.env.ENABLEMENT_SLACK_CHANNEL?.trim() || "";

function message(text: string, lines: string[], button: { label: string; url: string }): SlackMessage {
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: [`*${text}*`, ...lines.filter(Boolean)].join("\n") } },
      { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: button.label }, url: button.url }] },
    ],
  };
}

async function dm(email: string, msg: SlackMessage): Promise<void> {
  if (!slackConfigured()) return;
  try {
    const open = await openSlackDm(email);
    if (open.ok) await postSlackMessage(open.channel, msg);
  } catch (err) {
    console.warn("[enablement] DM failed:", err instanceof Error ? err.message : err);
  }
}

const quote = (s: string) => (s.trim() ? `> ${s.trim().replace(/\n+/g, "\n> ")}` : "");

export type Decision = "approved" | "gold" | "changes_requested" | "declined" | "revoked";

/** Tell the owner (and whoever asked, if someone else) what Enablement decided. */
export async function notifyDecision(opts: {
  to: string[];
  promptId: string;
  title: string;
  decision: Decision;
  reviewer: string;
  note: string;
  useCase?: string;
}): Promise<void> {
  const url = `${getSiteUrl()}/prompts/${opts.promptId}`;
  const t = `“${opts.title}”`;
  const msg =
    opts.decision === "gold"
      ? message(`🏅 ${t} is now the gold standard${opts.useCase ? ` for ${opts.useCase}` : ""}`, [`Picked by ${opts.reviewer}. It's what people will see first.`, quote(opts.note)], { label: "Open it", url })
      : opts.decision === "approved"
        ? message(`✅ Enablement approved ${t}`, [`Reviewed by ${opts.reviewer}. It now ranks higher in Discover, Claude and Slack.`, quote(opts.note)], { label: "Open it", url })
        : opts.decision === "changes_requested"
          ? message(`✏️ Changes requested on ${t}`, [`From ${opts.reviewer}:`, quote(opts.note)], { label: "Edit and resubmit", url: `${url}/edit` })
          : opts.decision === "declined"
            ? message(`${t} wasn't approved`, [`From ${opts.reviewer}:`, quote(opts.note)], { label: "Open it", url })
            : message(`Enablement removed the approval on ${t}`, [`From ${opts.reviewer}:`, quote(opts.note)], { label: "Open it", url });
  await Promise.all([...new Set(opts.to.map((e) => e.toLowerCase()))].map((e) => dm(e, msg)));
}

/** Let the Enablement channel know there's something to review. */
export async function notifyRequest(opts: { promptId: string; title: string; kind: string; requester: string; note: string; useCase?: string }): Promise<void> {
  if (!CHANNEL || !slackConfigured()) return;
  const msg = message(
    `📥 New review request from ${opts.requester}`,
    [`“${opts.title}” · ${opts.kind}${opts.useCase ? ` · ${opts.useCase}` : ""}`, quote(opts.note)],
    { label: "Review", url: `${getSiteUrl()}/enablement?item=${opts.promptId}` },
  );
  try {
    await postSlackMessage(CHANNEL, msg);
  } catch (err) {
    console.warn("[enablement] channel post failed:", err instanceof Error ? err.message : err);
  }
}
