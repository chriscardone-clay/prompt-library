import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ReviewReason, ReviewStatus } from "./approval";
import { personFromProfile } from "./people";
import type { Person } from "./types";

/** Data for Enablement Approved. Callers check enablementEnabled() first. */

export interface UseCase {
  id: string;
  name: string;
  description: string;
  goldPromptId: string | null;
  position: number;
  archived: boolean;
}

export interface Review {
  id: string;
  promptId: string;
  reason: ReviewReason;
  status: ReviewStatus;
  tier: "approved" | "gold" | null;
  useCaseId: string | null;
  requestedBy: Person | null;
  requestNote: string;
  reviewer: Person | null;
  decisionNote: string;
  rubric: Record<string, boolean>;
  bodySnapshot: string | null;
  decidedAt: string | null;
  createdAt: string;
}

type ProfileRow = { id: string; email: string; name: string; avatar_url: string | null };
type ReviewRow = {
  id: string;
  prompt_id: string;
  reason: ReviewReason;
  status: ReviewStatus;
  tier: "approved" | "gold" | null;
  use_case_id: string | null;
  request_note: string;
  decision_note: string;
  rubric: Record<string, boolean> | null;
  body_snapshot?: string | null;
  decided_at: string | null;
  created_at: string;
  requester: ProfileRow | null;
  reviewer: ProfileRow | null;
};

const REVIEW_SELECT = `id, prompt_id, reason, status, tier, use_case_id, request_note, decision_note, rubric, decided_at, created_at,
  requester:profiles!prompt_reviews_requested_by_fkey ( id, email, name, avatar_url ),
  reviewer:profiles!prompt_reviews_reviewer_id_fkey ( id, email, name, avatar_url )`;

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    promptId: r.prompt_id,
    reason: r.reason,
    status: r.status,
    tier: r.tier,
    useCaseId: r.use_case_id,
    requestedBy: r.requester ? personFromProfile(r.requester) : null,
    requestNote: r.request_note ?? "",
    reviewer: r.reviewer ? personFromProfile(r.reviewer) : null,
    decisionNote: r.decision_note ?? "",
    rubric: r.rubric ?? {},
    bodySnapshot: r.body_snapshot ?? null,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

/** On the Enablement reviewers list (enablement_reviewers). Admins aren't reviewers unless listed. */
export const isReviewer = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_review");
  return !error && data === true;
});

export const listUseCases = cache(async (): Promise<UseCase[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enablement_use_cases")
    .select("id, name, description, gold_prompt_id, position, archived")
    .order("position")
    .order("name");
  if (error) throw new Error(`listUseCases: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; description: string; gold_prompt_id: string | null; position: number; archived: boolean }[]).map((u) => ({
    id: u.id,
    name: u.name,
    description: u.description ?? "",
    goldPromptId: u.gold_prompt_id,
    position: u.position,
    archived: u.archived,
  }));
});

/** An item's requests and decisions, newest first. */
export async function listReviews(promptId: string): Promise<Review[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("prompt_reviews").select(REVIEW_SELECT).eq("prompt_id", promptId).order("created_at", { ascending: false });
  if (error) throw new Error(`listReviews: ${error.message}`);
  return ((data ?? []) as unknown as ReviewRow[]).map(toReview);
}

/** Open requests across the library, oldest first (the queue). */
export async function listOpenReviews(): Promise<Review[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("prompt_reviews").select(REVIEW_SELECT).eq("status", "requested").order("created_at", { ascending: true });
  if (error) throw new Error(`listOpenReviews: ${error.message}`);
  return ((data ?? []) as unknown as ReviewRow[]).map(toReview);
}

/** The text Enablement last approved, for "changes since the approved version". */
export async function lastApprovedSnapshot(promptId: string): Promise<{ body: string; decidedAt: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prompt_reviews")
    .select("body_snapshot, decided_at")
    .eq("prompt_id", promptId)
    .eq("status", "approved")
    .not("body_snapshot", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { body_snapshot: string | null; decided_at: string | null } | null;
  return row?.body_snapshot != null ? { body: row.body_snapshot, decidedAt: row.decided_at } : null;
}

export async function listReviewers(): Promise<{ email: string; addedBy: string | null; createdAt: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("enablement_reviewers").select("email, added_by, created_at").order("email");
  return ((data ?? []) as { email: string; added_by: string | null; created_at: string }[]).map((r) => ({ email: r.email, addedBy: r.added_by, createdAt: r.created_at }));
}
