import type { Approval, Prompt } from "./types";

/**
 * Enablement Approved: how approval reads and ranks. Pure helpers, shared by
 * Discover (client), the Claude connector and the Slack assistant.
 */

/**
 * Added to search relevance after the relevance floor, so approval reorders
 * results that already match but never pulls in ones that don't. Only the
 * approved version counts: an item edited since approval gets no boost.
 */
export const GOLD_BOOST = 0.35;
export const APPROVED_BOOST = 0.2;

export function approvalBoost(a: Approval): number {
  if (!a.current) return 0;
  return a.tier === "gold" ? GOLD_BOOST : a.tier === "approved" ? APPROVED_BOOST : 0;
}

/** 2 = gold, 1 = approved (current version), 0 = everything else. */
export function approvalRank(a: Approval): number {
  if (!a.current) return 0;
  return a.tier === "gold" ? 2 : a.tier === "approved" ? 1 : 0;
}

export const isApproved = (p: Prompt) => approvalRank(p.approval) > 0;

/** "Recommended": gold standards, then approved, then most upvoted, then most recently updated. */
export function compareRecommended(a: Prompt, b: Prompt): number {
  return (
    approvalRank(b.approval) - approvalRank(a.approval) ||
    b.upvoteUserIds.length - a.upvoteUserIds.length ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

/** One line for the connector and Slack: what Enablement said about it. */
export function approvalLine(a: Approval): string {
  if (a.tier === "none") return "";
  const day = a.approvedAt ? a.approvedAt.slice(0, 10) : "";
  if (!a.current) return "Enablement approved an earlier version (changed since, awaiting re-review)";
  if (a.tier === "gold") return `Gold standard${a.useCase ? ` for ${a.useCase}` : ""} (Enablement)`;
  return `Enablement approved${day ? ` (reviewed ${day})` : ""}${a.useCase ? ` · use case: ${a.useCase}` : ""}`;
}

// ── Review vocabulary ────────────────────────────────────────────────
export const RUBRIC = [
  { key: "works", label: "Works as described", hint: "Ran it on a real case and got a usable result" },
  { key: "clear", label: "Clear to a new hire", hint: "Description, inputs and How to use make sense without asking anyone" },
  { key: "current", label: "Current", hint: "Matches today's product, pricing and messaging" },
  { key: "safe", label: "Safe", hint: "No customer data, secrets or internal-only links in the content" },
  { key: "unique", label: "Not a duplicate", hint: "Adds something over the gold standard for this use case" },
] as const;
export type RubricKey = (typeof RUBRIC)[number]["key"];

export const REVIEW_DUE_OPTIONS = [30, 90, 180] as const;
export const DEFAULT_DUE_DAYS = 90;
/** Approvals due within this many days show up under "Due". */
export const DUE_SOON_DAYS = 14;

export type ReviewStatus = "requested" | "approved" | "changes_requested" | "declined" | "withdrawn" | "revoked";
export type ReviewReason = "new" | "re_review" | "due" | "revoked";

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  requested: "Review requested",
  approved: "Approved",
  changes_requested: "Changes requested",
  declined: "Not approved",
  withdrawn: "Withdrawn",
  revoked: "Approval removed",
};

export const REASON_LABELS: Record<ReviewReason, string> = {
  new: "New request",
  re_review: "Re-review: changed since approval",
  due: "Periodic review",
  revoked: "Approval removed",
};

// ── Line diff (for "changes since the approved version") ─────────────
export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** LCS line diff. Returns null when the texts are too long to diff cheaply. */
export function diffLines(before: string, after: string, maxLines = 1500): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > maxLines || b.length > maxLines) return null;
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "del", text: a[i++] });
    } else {
      out.push({ op: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

/** Keep changed lines plus `context` lines around them; gaps become a single "…" marker. */
export function compactDiff(lines: DiffLine[], context = 2): (DiffLine | { op: "gap"; count: number })[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.op === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: (DiffLine | { op: "gap"; count: number })[] = [];
  let gap = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (gap) out.push({ op: "gap", count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ op: "gap", count: gap });
  return out;
}
