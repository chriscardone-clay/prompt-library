import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { avatarIsStale, syncSlackAvatar } from "./avatars";
import { type Catalog, type CatalogApp, type CatalogIntegration, type CatalogTeam } from "./catalog";
import { isStage, isTrigger, isVisibility } from "./constants";
import { personFromEmail, personFromProfile, UNKNOWN_PERSON } from "./people";
import { asFiles, asLinks } from "./skills";
import { type Approval, type Feedback, NO_APPROVAL, type Person, type Profile, type Prompt, type PromptNode, type PromptVersion } from "./types";

// ── Row shapes returned by PostgREST embeds ─────────────────────────
interface ProfileRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}
export interface PromptRow {
  id: string;
  kind: string | null;
  title: string;
  description: string;
  body: string;
  notes: string | null;
  files: unknown;
  links: unknown;
  workflow_trigger?: string | null;
  workflow_stage?: string | null;
  integrations?: string[] | null;
  customer_ready?: boolean | null;
  approval?: string | null;
  approval_stale?: boolean | null;
  approved_at?: string | null;
  approval_due_at?: string | null;
  approval_use_case?: string | null;
  outdated_at?: string | null;
  outdated_note?: string | null;
  approver?: ProfileRow | null;
  outdater?: ProfileRow | null;
  use_case?: { name: string } | null;
  audiences: string[] | null;
  visibility: string;
  owner_id: string;
  parent_id: string | null;
  fork_note: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
  owner: ProfileRow | null;
  prompt_apps: { app: string; surfaces: string[] | null; model?: string | null; model_required?: boolean | null }[];
  prompt_editors: { email: string; profile: ProfileRow | null }[];
  prompt_upvotes: { user_id: string }[];
  prompt_favorites?: { user_id: string }[];
}

export const PROMPT_SELECT = `
  id, kind, title, description, body, notes, files, links, audiences, visibility, owner_id, parent_id,
  fork_note, last_edited_by, created_at, updated_at,
  workflow_trigger, workflow_stage, integrations, customer_ready,
  approval, approval_stale, approved_at, approval_due_at, approval_use_case, outdated_at, outdated_note,
  approver:profiles!prompts_approved_by_fkey ( id, email, name, avatar_url ),
  outdater:profiles!prompts_outdated_by_fkey ( id, email, name, avatar_url ),
  use_case:enablement_use_cases!prompts_approval_use_case_fkey ( name ),
  owner:profiles!prompts_owner_id_fkey ( id, email, name, avatar_url ),
  prompt_apps ( app, surfaces, model, model_required ),
  prompt_editors ( email, profile:profiles!prompt_editors_profile_id_fkey ( id, email, name, avatar_url ) ),
  prompt_upvotes ( user_id ),
  prompt_favorites ( user_id )
`;

function toPerson(p: ProfileRow | null | undefined): Person {
  return p ? personFromProfile(p) : UNKNOWN_PERSON;
}

function toApproval(r: PromptRow): Approval {
  const tier = r.approval === "gold" || r.approval === "approved" ? r.approval : "none";
  const outdated = r.outdated_at ? { at: r.outdated_at, by: r.outdater ? personFromProfile(r.outdater) : null, note: r.outdated_note ?? "" } : null;
  if (tier === "none") return outdated ? { ...NO_APPROVAL, outdated } : NO_APPROVAL;
  return {
    tier,
    current: !r.approval_stale,
    approvedAt: r.approved_at ?? null,
    approvedBy: r.approver ? personFromProfile(r.approver) : null,
    dueAt: r.approval_due_at ?? null,
    useCaseId: r.approval_use_case ?? null,
    useCase: r.use_case?.name ?? "",
    outdated,
  };
}

export function toPrompt(r: PromptRow): Prompt {
  return {
    id: r.id,
    kind: r.kind === "skill" ? "skill" : r.kind === "workflow" ? "workflow" : "prompt",
    title: r.title,
    description: r.description ?? "",
    body: r.body,
    notes: r.notes ?? "",
    files: asFiles(r.files),
    links: asLinks(r.links),
    workflow: {
      trigger: isTrigger(r.workflow_trigger) ? r.workflow_trigger : "",
      stage: isStage(r.workflow_stage) ? r.workflow_stage : "",
      integrations: (r.integrations ?? []).filter((i) => typeof i === "string" && i.trim()),
      customerReady: !!r.customer_ready,
    },
    approval: toApproval(r),
    audiences: (r.audiences ?? []).filter((a) => typeof a === "string" && a.trim()),
    visibility: isVisibility(r.visibility) ? r.visibility : "public",
    ownerId: r.owner_id,
    owner: toPerson(r.owner),
    parentId: r.parent_id,
    forkNote: r.fork_note ?? "",
    lastEditedBy: r.last_edited_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    apps: (r.prompt_apps ?? [])
      .filter((a) => typeof a.app === "string" && a.app)
      .map((a) => ({ app: a.app, surfaces: a.surfaces ?? [], model: (a.model ?? "").trim(), required: !!a.model_required && !!(a.model ?? "").trim() })),
    editors: (r.prompt_editors ?? []).map((e) =>
      e.profile ? personFromProfile(e.profile) : personFromEmail(e.email),
    ),
    upvoteUserIds: (r.prompt_upvotes ?? []).map((u) => u.user_id),
    favoritedBy: (r.prompt_favorites ?? []).map((u) => u.user_id),
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
    .select("id, email, name, avatar_url, avatar_synced_at")
    .eq("id", uid)
    .maybeSingle();
  if (data) {
    const profile = data as Profile;
    // Photos come from Slack; refresh weekly so changes there show up here.
    return avatarIsStale(profile) ? syncSlackAvatar(supabase, profile) : profile;
  }
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

/** Is the current user on the admins list? (Server-side check; RLS enforces it too.) */
export const isAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
});

/**
 * Whether the signed-in person can see and create workflows: the
 * WORKFLOWS_BETA boolean in Vercel Flags, targeted per user (flags.ts), with
 * the WORKFLOWS_BETA env var as the fallback off Vercel. Admins get no bypass.
 */
export const workflowsEnabled = cache(async (): Promise<boolean> => {
  // Imported lazily: flags.ts imports this module for getCurrentUser.
  const { featureOn } = await import("./flags");
  return featureOn("workflows");
});

/** Enablement Approved: the ENABLEMENT_APPROVED flag, same rules as workflowsEnabled. */
export const enablementEnabled = cache(async (): Promise<boolean> => {
  const { featureOn } = await import("./flags");
  return featureOn("enablement");
});

/** The connector (MCP): the MCP_CONNECTOR flag, same rules as workflowsEnabled. */
export const connectorEnabled = cache(async (): Promise<boolean> => {
  const { featureOn } = await import("./flags");
  return featureOn("connector");
});

/** Ask AI on Discover: the AI_SEARCH flag, same rules as workflowsEnabled. */
export const aiSearchEnabled = cache(async (): Promise<boolean> => {
  const { featureOn } = await import("./flags");
  return featureOn("aiSearch");
});

/** Admins and Workflow maintainers (catalog_managers) may edit the Integrations catalog. */
export const canManageIntegrations = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_manage_integrations");
  return !error && data === true;
});

// ── Catalog (apps, surfaces, teams) ─────────────────────────────────
export const getCatalog = cache(async (): Promise<Catalog> => loadCatalog(await createClient()));

/** The catalog read through any client (the MCP connector uses the service client). */
export async function loadCatalog(supabase: SupabaseClient): Promise<Catalog> {
  const [appsRes, surfRes, teamsRes, intRes] = await Promise.all([
    supabase.from("apps").select("name, bg, fg, install, archived, position, model_hint").order("position").order("name"),
    supabase.from("surfaces").select("app, name, install, position").order("position").order("name"),
    supabase.from("teams").select("name, archived, position").order("position").order("name"),
    supabase.from("integrations").select("name, color, archived, position").order("position").order("name"),
  ]);
  if (appsRes.error) throw new Error(`getCatalog apps: ${appsRes.error.message}`);
  if (surfRes.error) throw new Error(`getCatalog surfaces: ${surfRes.error.message}`);
  if (teamsRes.error) throw new Error(`getCatalog teams: ${teamsRes.error.message}`);
  type AppRow = { name: string; bg: string; fg: string; install: string | null; archived: boolean; position: number; model_hint: string | null };
  type SurfRow = { app: string; name: string; install: string | null; position: number };
  type TeamRow = { name: string; archived: boolean; position: number };
  const surfaces = (surfRes.data ?? []) as SurfRow[];
  const apps: CatalogApp[] = ((appsRes.data ?? []) as AppRow[]).map((a) => ({
    name: a.name,
    bg: a.bg,
    fg: a.fg,
    install: a.install ?? "",
    modelHint: a.model_hint ?? "",
    archived: a.archived,
    position: a.position,
    surfaces: surfaces
      .filter((s) => s.app === a.name)
      .map((s) => ({ name: s.name, install: s.install ?? "", position: s.position })),
  }));
  const teams: CatalogTeam[] = ((teamsRes.data ?? []) as TeamRow[]).map((t) => ({
    name: t.name,
    archived: t.archived,
    position: t.position,
  }));
  // Integrations are workflow-only: a failed read leaves the list empty rather than breaking every page.
  const integrations = intRes.error ? [] : ((intRes.data ?? []) as CatalogIntegration[]);
  return { apps, teams, integrations };
}

/** How many items use each app / surface / team. Admin page only. */
export async function getCatalogUsage(): Promise<{
  apps: Record<string, number>;
  surfaces: Record<string, number>; // key "App · Surface"
  teams: Record<string, number>;
}> {
  const supabase = await createClient();
  const [pa, pr] = await Promise.all([
    supabase.from("prompt_apps").select("app, surfaces"),
    supabase.from("prompts").select("audiences"),
  ]);
  const apps: Record<string, number> = {};
  const surfaces: Record<string, number> = {};
  const teams: Record<string, number> = {};
  for (const row of (pa.data ?? []) as { app: string; surfaces: string[] | null }[]) {
    apps[row.app] = (apps[row.app] ?? 0) + 1;
    for (const s of row.surfaces ?? []) {
      const k = `${row.app} · ${s}`;
      surfaces[k] = (surfaces[k] ?? 0) + 1;
    }
  }
  for (const row of (pr.data ?? []) as { audiences: string[] | null }[]) {
    for (const t of row.audiences ?? []) teams[t] = (teams[t] ?? 0) + 1;
  }
  return { apps, surfaces, teams };
}

// ── Prompts ─────────────────────────────────────────────────────────
/** Every prompt the current user may see (RLS enforces public / owner / editor). */
export const listPrompts = cache(async (): Promise<Prompt[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prompts")
    .select(PROMPT_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listPrompts: ${error.message}`);
  const all = await hideApprovalUnlessEnabled(((data ?? []) as unknown as PromptRow[]).map(toPrompt));
  return (await workflowsEnabled()) ? all : all.filter((p) => p.kind !== "workflow");
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
  if (!data) return null;
  const [p] = await hideApprovalUnlessEnabled([toPrompt(data as unknown as PromptRow)]);
  return p.kind === "workflow" && !(await workflowsEnabled()) ? null : p;
}

/** Without the ENABLEMENT_APPROVED flag, nothing is approved or outdated: no badges, no boost, no demotion. */
async function hideApprovalUnlessEnabled(items: Prompt[]): Promise<Prompt[]> {
  return (await enablementEnabled()) ? items : items.map((p) => (p.approval.tier === "none" && !p.approval.outdated ? p : { ...p, approval: NO_APPROVAL }));
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
      `id, prompt_id, title, description, body, files, links, saved_at,
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
    files: unknown;
    links: unknown;
    saved_at: string;
    saved_by: ProfileRow | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    promptId: r.prompt_id,
    title: r.title,
    description: r.description ?? "",
    body: r.body,
    files: asFiles(r.files),
    links: asLinks(r.links),
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
