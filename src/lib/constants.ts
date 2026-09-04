export const APPS = ["Town", "Claude", "ChatGPT", "Claygent", "Monty", "Granola"] as const;
export type App = (typeof APPS)[number];

export const AUDIENCES = ["EPD", "GS", "GTM", "Other"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Tag colours per app — 100 tint background, 400 shade ink (Terra palette). */
export const APP_COLORS: Record<App, { bg: string; fg: string }> = {
  Town: { bg: "#F5F3FF", fg: "#6D4CD6" },
  Claude: { bg: "#FFF3ED", fg: "#B53D0A" },
  ChatGPT: { bg: "#FCFEE2", fg: "#808000" },
  Claygent: { bg: "#F0FCFF", fg: "#008BAD" },
  Monty: { bg: "#FFF0FA", fg: "#CC089E" },
  Granola: { bg: "#FEFAE8", fg: "#9E5802" },
};

/** Apps that have distinct surfaces a prompt can be scoped to. */
export const SURFACES: Partial<Record<App, readonly string[]>> = {
  Claude: ["Chat", "Code", "Cowork"],
  ChatGPT: ["Chat", "Codex", "Work"],
};

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

/** How to install a skill's files, keyed by "App · Surface" or just "App". */
export const INSTALL: Record<string, string> = {
  "Claude · Code":
    "Copy the folder into ~/.claude/skills/ (or .claude/skills/ in your repo). Claude picks it up on the next session.",
  "Claude · Cowork": "Download the .skill file and upload it under Settings, Capabilities, Skills.",
  "Claude · Chat": "Download the .skill file and upload it under Settings, Capabilities, Skills.",
  Claude:
    "Download the .skill file and upload it under Settings, Capabilities, Skills, or unzip it into ~/.claude/skills/ for Claude Code.",
  "ChatGPT · Codex": "Reference the files from your AGENTS.md so Codex reads them at the start of a task.",
  "ChatGPT · Work": "Add SKILL.md and its files to the project’s files.",
  "ChatGPT · Chat": "Add SKILL.md and its files to a project or custom GPT’s knowledge.",
  ChatGPT: "Add the files to a project’s knowledge, or reference them from AGENTS.md for Codex.",
  Town: "Upload the files to the agent’s knowledge.",
  Claygent: "Paste SKILL.md into the Claygent column prompt.",
  Monty: "Upload the files to Monty’s knowledge.",
  Granola: "Paste SKILL.md into a Granola recipe.",
};

export const SORTS = ["top", "new", "updated"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  top: "Top rated",
  new: "Newest",
  updated: "Recently updated",
};

export const ALLOWED_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() || "clay.com";

export function isApp(x: string): x is App {
  return (APPS as readonly string[]).includes(x);
}
export function isAudience(x: string): x is Audience {
  return (AUDIENCES as readonly string[]).includes(x);
}
export function isVisibility(x: string): x is Visibility {
  return (VISIBILITIES as readonly string[]).includes(x);
}
export function isSort(x: string): x is Sort {
  return (SORTS as readonly string[]).includes(x);
}
export function isKind(x: string): x is Kind {
  return (KINDS as readonly string[]).includes(x);
}
