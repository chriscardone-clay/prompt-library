import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { asFiles } from "./skills";
import type { SkillFile } from "./types";

/**
 * Publish links: a read-only snapshot of a customer-ready workflow at
 * /s/<token>, opened without signing in. Rows live in workflow_shares
 * (migration 0023); the app writes them with the service role after checking
 * edit rights, and the public page reads only that table, never prompts.
 */

export const EXPIRY_DAYS = [0, 30, 90, 365] as const;
export type ExpiryDays = (typeof EXPIRY_DAYS)[number];

/** Storage prefix for a share's copied attachments, so later edits or deletes don't touch them. */
export const sharePrefix = (shareId: string) => `shares/${shareId}`;

/** 32 random bytes, base64url: 43 characters, not guessable. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isTokenShaped(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,64}$/.test(token);
}

/** A link as the owner and editors see it on the workflow page. */
export interface ShareSummary {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  expired: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  sourceUpdatedAt: string;
  attachments: string[];
}

/** The snapshot the public page renders. */
export interface PublicShare {
  id: string;
  title: string;
  description: string;
  file: SkillFile;
  attachments: SkillFile[];
  createdAt: string;
  updatedAt: string;
}

interface ShareRow {
  id: string;
  token: string;
  label: string;
  title: string;
  description: string;
  file: unknown;
  attachments: unknown;
  source_updated_at: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  creator?: { name: string } | { name: string }[] | null;
}

const isExpired = (r: Pick<ShareRow, "expires_at">) => !!r.expires_at && new Date(r.expires_at).getTime() <= Date.now();

/** Live (not revoked) links for a workflow, read through the user's client: RLS shows owners and editors every link, everyone else the ones they published. */
export async function listShares(promptId: string): Promise<ShareSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_shares")
    .select(
      "id, token, label, attachments, source_updated_at, created_at, expires_at, revoked_at, view_count, last_viewed_at, creator:profiles!workflow_shares_created_by_fkey ( name )",
    )
    .eq("prompt_id", promptId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as unknown as ShareRow[]).map((r) => {
    const creator = Array.isArray(r.creator) ? r.creator[0] : r.creator;
    return {
      id: r.id,
      token: r.token,
      label: r.label,
      createdAt: r.created_at,
      createdBy: creator?.name ?? null,
      expiresAt: r.expires_at,
      expired: isExpired(r),
      viewCount: r.view_count,
      lastViewedAt: r.last_viewed_at,
      sourceUpdatedAt: r.source_updated_at,
      attachments: asFiles(r.attachments).map((f) => f.name),
    };
  });
}

/**
 * The snapshot behind a public token, or null when the token is unknown,
 * revoked or expired. All three look the same to the visitor.
 */
export async function findPublicShare(token: string): Promise<PublicShare | null> {
  if (!isTokenShaped(token)) return null;
  let service;
  try {
    service = createServiceClient();
  } catch {
    return null;
  }
  const { data, error } = await service
    .from("workflow_shares")
    .select("id, title, description, file, attachments, created_at, updated_at, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as ShareRow;
  if (r.revoked_at || isExpired(r)) return null;
  const file = asFiles([r.file])[0];
  if (!file) return null;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    file,
    attachments: asFiles(r.attachments).filter((f) => !!f.path),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Count a page view. Best effort: a failed count never blocks the page. */
export async function recordShareView(shareId: string): Promise<void> {
  try {
    await createServiceClient().rpc("record_share_view", { p_share: shareId });
  } catch {
    /* ignore */
  }
}
