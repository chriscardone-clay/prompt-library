/**
 * Static app constants. Apps, surfaces and teams are NOT here any more: they
 * live in the database (see src/lib/catalog.ts and /admin).
 */

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const KINDS = ["prompt", "skill"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, { one: string; many: string }> = {
  prompt: { one: "prompt", many: "prompts" },
  skill: { one: "skill", many: "skills" },
};

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

export function isVisibility(x: string): x is Visibility {
  return (VISIBILITIES as readonly string[]).includes(x);
}
export function isSort(x: string): x is Sort {
  return (SORTS as readonly string[]).includes(x);
}
export function isKind(x: string): x is Kind {
  return (KINDS as readonly string[]).includes(x);
}
