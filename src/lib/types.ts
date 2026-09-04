import type { App, Audience, Kind, Visibility } from "./constants";

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

/** A person shown in the UI. Editors who haven't signed in yet have no id. */
export interface Person {
  id: string | null;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface PromptApp {
  app: App;
  surfaces: string[];
}

export interface PromptEditor {
  email: string;
  profile: Profile | null;
}

/** A text file inside a skill bundle (SKILL.md, references, templates). */
export interface SkillFile {
  name: string;
  content: string;
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
  /** Teams this is for; at least one. */
  audiences: Audience[];
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
  audiences: Audience[];
  visibility: Visibility;
  forkNote: string;
  editors: string[]; // emails
}
