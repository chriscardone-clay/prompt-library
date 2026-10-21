/**
 * Static app constants. Apps, surfaces and teams are NOT here any more: they
 * live in the database (see src/lib/catalog.ts and /admin).
 */

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const KINDS = ["prompt", "skill", "workflow"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, { one: string; many: string }> = {
  prompt: { one: "prompt", many: "prompts" },
  skill: { one: "skill", many: "skills" },
  workflow: { one: "workflow", many: "workflows" },
};

// ── Workflows (behind WORKFLOWS_BETA; see src/lib/features.ts) ─────────
export const WORKFLOW_TRIGGERS = ["webhook", "schedule", "table", "manual", "other"] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];
export const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  webhook: "Webhook",
  schedule: "Schedule",
  table: "Table row",
  manual: "Manual",
  other: "Other",
};
export const WORKFLOW_STAGES = ["draft", "tested", "production"] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export const STAGE_LABELS: Record<WorkflowStage, string> = {
  draft: "Draft",
  tested: "Tested",
  production: "In production",
};
/** Offered in the editor and spotted in uploaded docs; people can add others. */
export const SUGGESTED_INTEGRATIONS = [
  "Salesforce",
  "HubSpot",
  "Slack",
  "Snowflake",
  "ZoomInfo",
  "ZeroBounce",
  "Clay tables",
  "Gong",
  "Outreach",
  "Marketo",
  "BigQuery",
] as const;
export const MAX_INTEGRATIONS = 20;
/** The architecture .md is sent inline with the save, like skill text files. */
export const MAX_WORKFLOW_DOC_BYTES = 512 * 1024;
/** The app the workflow editor ticks by default (seeded by migration 0022). */
export const WORKFLOW_APP = "Clay Workflows";

/** Starting .md for a workflow written in the editor. */
export const WORKFLOW_TEMPLATE =
  "# Workflow name — reference architecture\n\nOne paragraph: what the flow does, for whom, and what it writes.\n\n## At a glance\n\n| | |\n|---|---|\n| Trigger | |\n| Nodes | |\n| Exit | |\n\n## 1. What the flow does\n\n## 2. Flow map\n\n```\n[trigger] …\n```\n\n## 3. Input contract\n\n## 4. Gate logic\n\n## 5. Code nodes\n\n## 6. LLM nodes\n\n## 7. Actions used\n\n## 8. What you must supply\n\n## 9. Build recipe\n\n## 10. Design lessons\n\n## 11. Known issues\n";

/** A skill bundle (text inline + binaries in storage) may total this many bytes. */
export const MAX_SKILL_BYTES = 5 * 1024 * 1024;
/** Inline text files travel in the save request, so they get a lower cap. */
export const MAX_SKILL_TEXT_BYTES = 1_500_000;
export const MAX_SKILL_FILES = 60;
/** Supabase Storage bucket for binary skill files. */
export const SKILL_BUCKET = "skill-files";

/** Starting SKILL.md for a new skill. */
export const SKILL_TEMPLATE =
  "---\nname: my-skill\ndescription: One sentence on what this skill does and when to use it.\n---\n\n# My skill\n\n## When to use\n\n## Steps\n\n1. \n2. \n\n## Output format\n";

export const SORTS = ["top", "new", "updated"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  top: "Top rated",
  new: "Newest",
  updated: "Recently updated",
};

export const ALLOWED_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() || "clay.com";

/** Slack DM with the author, linked from the footer credit. */
export const AUTHOR_SLACK_URL = "https://clay-hq.slack.com/archives/D09HBPERX1S";
export const AUTHOR_HANDLE = "@cc";

/** The Slack channel where the weekly digest lands and the join banner points. */
export const SLACK_CHANNEL_ID = "C0BV3T33NSH";
export const SLACK_CHANNEL_NAME = "#auto-clayprompts";
export const SLACK_CHANNEL_URL = "https://clay-hq.slack.com/archives/C0BV3T33NSH";

export function isVisibility(x: string): x is Visibility {
  return (VISIBILITIES as readonly string[]).includes(x);
}
export function isSort(x: string): x is Sort {
  return (SORTS as readonly string[]).includes(x);
}
export function isKind(x: string): x is Kind {
  return (KINDS as readonly string[]).includes(x);
}
export function isTrigger(x: unknown): x is WorkflowTrigger {
  return typeof x === "string" && (WORKFLOW_TRIGGERS as readonly string[]).includes(x);
}
export function isStage(x: unknown): x is WorkflowStage {
  return typeof x === "string" && (WORKFLOW_STAGES as readonly string[]).includes(x);
}
