import "server-only";
import { featureOn } from "./flags";
import { getSiteUrl } from "./site";
import { openSlackDm, postSlackMessage, slackConfigured, type SlackMessage } from "./slack";
import { createServiceClient } from "./supabase/service";

/**
 * Slack messages for Enablement Approved. Best effort: a missing token, an
 * unknown email or a Slack error never fails the review itself.
 *
 * While Enablement is behind the ENABLEMENT_APPROVED flag, DMs only go to
 * people the flag is on for, so nobody hears about a feature they can't see.
 * The review-request channel post isn't per person: point
 * ENABLEMENT_SLACK_CHANNEL at a channel of reviewers.
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

/** The recipients the Enablement flag is on for, evaluated as their own account (id and email). */
async function withFlag(emails: string[]): Promise<string[]> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return [];
  const { data } = await createServiceClient().from("profiles").select("id, email").in("email", unique);
  const ids = new Map((data ?? []).map((r: { id: string; email: string }) => [r.email.toLowerCase(), r.id]));
  const on = await Promise.all(unique.map((email) => featureOn("enablement", { id: ids.get(email) ?? email, email }).catch(() => false)));
  return unique.filter((_, i) => on[i]);
}

const quote = (s: string) => (s.trim() ? `> ${s.trim().replace(/\n+/g, "\n> ")}` : "");

export type Decision = "approved" | "gold" | "changes_requested" | "declined" | "revoked" | "outdated" | "editor_joined";

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
            : opts.decision === "editor_joined"
              ? message(`✏️ ${opts.reviewer} from Enablement joined ${t} as an editor`, ["They can now update it (for example after a product change). Its version history keeps every change.", quote(opts.note)], { label: "Open it", url })
            : opts.decision === "outdated"
              ? message(`⚠️ Enablement flagged ${t} as outdated`, [`From ${opts.reviewer}:`, quote(opts.note), "It's listed after current items until you update it and it's approved again."], { label: "Update it", url: `${url}/edit` })
              : message(`Enablement removed the approval on ${t}`, [`From ${opts.reviewer}:`, quote(opts.note)], { label: "Open it", url });
  const to = await withFlag(opts.to);
  await Promise.all(to.map((e) => dm(e, msg)));
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
