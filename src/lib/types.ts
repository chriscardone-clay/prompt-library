import type { Kind, Visibility } from "./constants";

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  /** Last Slack photo refresh; only loaded for the signed-in user. */
  avatar_synced_at?: string | null;
}

/** A person shown in the UI. Editors who haven't signed in yet have no id. */
export interface Person {
  id: string | null;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** An app (from the catalog) a prompt is built for, with optional surfaces. */
export interface PromptApp {
  app: string;
  surfaces: string[];
}

export interface PromptEditor {
  email: string;
  profile: Profile | null;
}

/**
 * A file inside a skill bundle. Text files (SKILL.md, references, scripts)
 * carry their content inline and are editable. Binary files (fonts, images)
 * live in the `skill-files` storage bucket: `path` points at the object,
 * `size` is its byte length, and `content` is empty.
 */
export interface SkillFile {
  name: string;
  content: string;
  path?: string;
  size?: number;
  type?: string;
}

export function isBinaryFile(f: SkillFile): boolean {
  return typeof f.path === "string" && f.path.length > 0;
}

/** Where a skill lives in its home app (a Claude project, a custom GPT, a Town agent). */
export interface SkillLink {
  label: string;
  url: string;
}

export interface Prompt {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  /** Prompt text; for skills, the SKILL.md content (or empty for link-only skills). */
  body: string;
  /** Optional "How to use" guidance: when to use it, tips, connectors it needs. */
  notes: string;
  files: SkillFile[];
  links: SkillLink[];
  /** Teams (from the catalog) this is for; at least one. */
  audiences: string[];
  visibility: Visibility;
  ownerId: string;
  owner: Person;
  parentId: string | null;
  forkNote: string;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
  apps: PromptApp[];
  editors: Person[];
  upvoteUserIds: string[];
}

export interface PromptVersion {
  id: string;
  promptId: string;
  title: string;
  description: string;
  body: string;
  files: SkillFile[];
  links: SkillLink[];
  savedAt: string;
  savedBy: Person | null;
}

export interface Feedback {
  id: string;
  promptId: string;
  author: Person;
  text: string;
  resolved: boolean;
  reply: string;
  replyBy: Person | null;
  createdAt: string;
}

/** Lightweight prompt row used for the variants tree and fork counts. */
export interface PromptNode {
  id: string;
  title: string;
  parentId: string | null;
  forkNote: string;
  owner: Person;
  createdAt: string;
  upvotes: number;
}

export interface PromptDraft {
  kind: Kind;
  title: string;
  description: string;
  body: string;
  notes: string;
  files: SkillFile[];
  links: SkillLink[];
  apps: PromptApp[];
  audiences: string[];
  visibility: Visibility;
  forkNote: string;
  editors: string[]; // emails
}
