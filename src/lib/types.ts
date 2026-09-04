import type { App, Audience, Visibility } from "./constants";

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

export interface Prompt {
  id: string;
  title: string;
  description: string;
  body: string;
  audience: Audience;
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
  title: string;
  description: string;
  body: string;
  apps: PromptApp[];
  audience: Audience;
  visibility: Visibility;
  forkNote: string;
  editors: string[]; // emails
}
