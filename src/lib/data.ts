import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isApp, isAudience, isVisibility } from "./constants";
import { personFromEmail, personFromProfile, UNKNOWN_PERSON } from "./people";
import type { Feedback, Person, Profile, Prompt, PromptNode, PromptVersion } from "./types";

// ── Row shapes returned by PostgREST embeds ─────────────────────────
interface ProfileRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}
interface PromptRow {
  id: string;
  title: string;
  description: string;
  body: string;
  audience: string;
  visibility: string;
  owner_id: string;
  parent_id: string | null;
  fork_note: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
  owner: ProfileRow | null;
  prompt_apps: { app: string; surfaces: string[] | null }[];
  prompt_editors: { email: string; profile: ProfileRow | null }[];
  prompt_upvotes: { user_id: string }[];
}

const PROMPT_SELECT = `
  id, title, description, body, audience, visibility, owner_id, parent_id,
  fork_note, last_edited_by, created_at, updated_at,
  owner:profiles!prompts_owner_id_fkey ( id, email, name, avatar_url ),
  prompt_apps ( app, surfaces ),
  prompt_editors ( email, profile:profiles!prompt_editors_profile_id_fkey ( id, email, name, avatar_url ) ),
  prompt_upvotes ( user_id )
`;

function toPerson(p: ProfileRow | null | undefined): Person {
  return p ? personFromProfile(p) : UNKNOWN_PERSON;
}

function toPrompt(r: PromptRow): Prompt {
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    body: r.body,
    audience: isAudience(r.audience) ? r.audience : "Other",
    visibility: isVisibility(r.visibility) ? r.visibility : "public",
    ownerId: r.owner_id,
    owner: toPerson(r.owner),
    parentId: r.parent_id,
    forkNote: r.fork_note ?? "",
    lastEditedBy: r.last_edited_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    apps: (r.prompt_apps ?? [])
      .filter((a) => isApp(a.app))
      .map((a) => ({ app: a.app as Prompt["apps"][number]["app"], surfaces: a.surfaces ?? [] })),
    editors: (r.prompt_editors ?? []).map((e) =>
      e.profile ? personFromProfile(e.profile) : personFromEmail(e.email),
    ),
    upvoteUserIds: (r.prompt_upvotes ?? []).map((u) => u.user_id),
  };
}

// ── Current user ────────────────────────────────────────────────────
export const getCurrentUser = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, email, name, avatar_url")
    .eq("id", uid)
    .maybeSingle();
  if (data) return data as Profile;
  // Profile row is created by a DB trigger; fall back to the JWT if it lags.
  const c = claims!.claims as Record<string, unknown>;
  const meta = (c.user_metadata ?? {}) as Record<string, string | undefined>;
  return {
    id: uid,
    email: String(c.email ?? ""),
    name: meta.full_name || meta.name || String(c.email ?? "").split("@")[0],
    avatar_url: meta.avatar_url || meta.picture || null,
  };
});

// ── Prompts ─────────────────────────────────────────────────────────
/** Every prompt the current user may see (RLS enforces public / owner / editor). */
export const listPrompts = cache(async (): Promise<Prompt[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompts")
    .select(PROMPT_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listPrompts: ${error.message}`);
  return ((data ?? []) as unknown as PromptRow[]).map(toPrompt);
});

export async function getPrompt(id: string): Promise<Prompt | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompts")
    .select(PROMPT_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (error.code === "22P02") return null; // not a uuid
    throw new Error(`getPrompt: ${error.message}`);
  }
  return data ? toPrompt(data as unknown as PromptRow) : null;
}

/** Lightweight rows for fork counts and the variants tree. */
export const listPromptNodes = cache(async (): Promise<PromptNode[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompts")
    .select(
      `id, title, parent_id, fork_note, created_at,
       owner:profiles!prompts_owner_id_fkey ( id, email, name, avatar_url ),
       prompt_upvotes ( user_id )`,
    );
  if (error) throw new Error(`listPromptNodes: ${error.message}`);
  type Row = {
    id: string;
    title: string;
    parent_id: string | null;
    fork_note: string;
    created_at: string;
    owner: ProfileRow | null;
    prompt_upvotes: { user_id: string }[];
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    title: r.title,
    parentId: r.parent_id,
    forkNote: r.fork_note ?? "",
    owner: toPerson(r.owner),
    createdAt: r.created_at,
    upvotes: r.prompt_upvotes?.length ?? 0,
  }));
});

// ── Versions ────────────────────────────────────────────────────────
export async function listVersions(promptId: string): Promise<PromptVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select(
      `id, prompt_id, title, description, body, saved_at,
       saved_by:profiles!prompt_versions_saved_by_fkey ( id, email, name, avatar_url )`,
    )
    .eq("prompt_id", promptId)
    .order("saved_at", { ascending: true });
  if (error) throw new Error(`listVersions: ${error.message}`);
  type Row = {
    id: string;
    prompt_id: string;
    title: string;
    description: string;
    body: string;
    saved_at: string;
    saved_by: ProfileRow | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    promptId: r.prompt_id,
    title: r.title,
    description: r.description ?? "",
    body: r.body,
    savedAt: r.saved_at,
    savedBy: r.saved_by ? personFromProfile(r.saved_by) : null,
  }));
}

// ── Feedback ────────────────────────────────────────────────────────
export async function listFeedback(promptId: string): Promise<Feedback[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .select(
      `id, prompt_id, text, resolved, reply, created_at,
       author:profiles!feedback_user_id_fkey ( id, email, name, avatar_url ),
       reply_by:profiles!feedback_reply_by_fkey ( id, email, name, avatar_url )`,
    )
    .eq("prompt_id", promptId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listFeedback: ${error.message}`);
  type Row = {
    id: string;
    prompt_id: string;
    text: string;
    resolved: boolean;
    reply: string;
    created_at: string;
    author: ProfileRow | null;
    reply_by: ProfileRow | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    promptId: r.prompt_id,
    author: toPerson(r.author),
    text: r.text,
    resolved: r.resolved,
    reply: r.reply ?? "",
    replyBy: r.reply_by ? personFromProfile(r.reply_by) : null,
    createdAt: r.created_at,
  }));
}

// ── Permissions (mirrors the SQL helpers, for rendering only) ───────
export function canEdit(prompt: Prompt, user: Profile | null): boolean {
  if (!user) return false;
  if (prompt.ownerId === user.id) return true;
  const email = user.email.toLowerCase();
  return prompt.editors.some((e) => e.id === user.id || e.email.toLowerCase() === email);
}
