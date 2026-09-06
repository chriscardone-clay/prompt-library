/** Shape returned by the weekly_digest() SQL function. */
export interface DigestApp {
  app: string;
  surfaces: string[];
}

export interface DigestTopItem {
  id: string;
  title: string;
  description: string;
  kind: "prompt" | "skill";
  owner_name: string | null;
  apps: DigestApp[];
  upvotes_week: number;
  upvotes_total: number;
  forks_week: number;
  feedback_week: number;
  score: number;
}

export interface DigestNewItem {
  id: string;
  title: string;
  kind: "prompt" | "skill";
  owner_name: string | null;
  apps: DigestApp[];
  created_at: string;
  parent_title: string | null;
}

export interface DigestUpdatedItem {
  id: string;
  title: string;
  versions: number;
  last_editor: string | null;
}

export interface DigestOpenFeedback {
  id: string;
  title: string;
  open_count: number;
}

export interface DigestData {
  from: string;
  to: string;
  stats: {
    total: number;
    new: number;
    upvotes: number;
    forks: number;
    feedback: number;
    resolved: number;
    open_feedback: number;
  };
  top: DigestTopItem[];
  new_items: DigestNewItem[];
  updated: DigestUpdatedItem[];
  open_feedback_items: DigestOpenFeedback[];
  catalog: { apps: string[]; surfaces: string[]; teams: string[] };
}

export interface DigestSettings {
  enabled: boolean;
  channel: string;
  editors_note: string;
  updated_at: string;
  updated_by: string | null;
}

export interface DigestRun {
  id: string;
  week_start: string;
  kind: "channel" | "resend" | "test";
  channel: string;
  slack_ts: string | null;
  posted_at: string;
  posted_by: string;
  stats: DigestData["stats"];
}

/** Slack Block Kit, loosely typed: we only build a handful of block shapes. */
export type SlackBlock = Record<string, unknown>;

export interface DigestMessage {
  blocks: SlackBlock[];
  /** Plain-text fallback for notifications and clients without Block Kit. */
  text: string;
}
