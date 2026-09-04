"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/app/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { isAdmin } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 40;
const INSTALL_MAX = 600;

async function requireAdmin() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  if (!(await isAdmin())) return { supabase, error: "Admins only." as const };
  return { supabase, error: null };
}

/** The catalog feeds every page, so bust everything. */
function revalidateAll() {
  revalidatePath("/", "layout");
}

function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s && s.length <= NAME_MAX ? s : null;
}

// ── Apps ────────────────────────────────────────────────────────────
export interface AppInput {
  /** Existing name when editing (rename cascades into items). */
  originalName?: string;
  name: string;
  bg: string;
  fg: string;
  install: string;
  archived: boolean;
}

export async function saveApp(input: AppInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `App name must be 1–${NAME_MAX} characters.` };
  if (!HEX.test(input.bg) || !HEX.test(input.fg)) return { ok: false, error: "Colours must be hex like #FFF3ED." };
  const install = String(input.install ?? "").trim().slice(0, INSTALL_MAX);
  const row = { name, bg: input.bg.toUpperCase(), fg: input.fg.toUpperCase(), install, archived: !!input.archived };

  if (input.originalName && input.originalName !== name) {
    const { error: e } = await supabase.from("apps").update(row).eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else if (input.originalName) {
    const { error: e } = await supabase.from("apps").update(row).eq("name", name);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase.from("apps").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { error: e } = await supabase.from("apps").insert({ ...row, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `An app called ${name} already exists.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteApp(name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("apps").delete().eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Surfaces ────────────────────────────────────────────────────────
export interface SurfaceInput {
  app: string;
  originalName?: string;
  name: string;
  install: string;
}

export async function saveSurface(input: SurfaceInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `Surface name must be 1–${NAME_MAX} characters.` };
  const install = String(input.install ?? "").trim().slice(0, INSTALL_MAX);
  if (input.originalName) {
    const { error: e } = await supabase
      .from("surfaces")
      .update({ name, install })
      .eq("app", input.app)
      .eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase
      .from("surfaces")
      .select("position")
      .eq("app", input.app)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: e } = await supabase
      .from("surfaces")
      .insert({ app: input.app, name, install, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `${input.app} already has a surface called ${name}.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteSurface(app: string, name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("surfaces").delete().eq("app", app).eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Teams ───────────────────────────────────────────────────────────
export interface TeamInput {
  originalName?: string;
  name: string;
  archived: boolean;
}

export async function saveTeam(input: TeamInput): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `Team name must be 1–${NAME_MAX} characters.` };
  const row = { name, archived: !!input.archived };
  if (input.originalName) {
    const { error: e } = await supabase.from("teams").update(row).eq("name", input.originalName);
    if (e) return { ok: false, error: e.message };
  } else {
    const { data: max } = await supabase.from("teams").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { error: e } = await supabase.from("teams").insert({ ...row, position: ((max?.position as number) ?? 0) + 1 });
    if (e) return { ok: false, error: e.code === "23505" ? `A team called ${name} already exists.` : e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteTeam(name: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { error: e } = await supabase.from("teams").delete().eq("name", name);
  if (e) return { ok: false, error: e.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Ordering ────────────────────────────────────────────────────────
/** Persist a new order: position = index. For surfaces, `scope` is the app name. */
export async function reorder(kind: "apps" | "teams" | "surfaces", names: string[], scope?: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  for (let i = 0; i < names.length; i++) {
    let q = supabase.from(kind).update({ position: i + 1 }).eq("name", names[i]);
    if (kind === "surfaces") q = q.eq("app", scope ?? "");
    const { error: e } = await q;
    if (e) return { ok: false, error: e.message };
  }
  revalidateAll();
  return { ok: true, data: undefined };
}

// ── Admins ──────────────────────────────────────────────────────────
export async function addAdmin(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const e = email.trim().toLowerCase();
  if (!e.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return { ok: false, error: `Admins need an @${ALLOWED_EMAIL_DOMAIN} address.` };
  const { error: err } = await supabase.from("admins").upsert({ email: e }, { onConflict: "email" });
  if (err) return { ok: false, error: err.message };
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function removeAdmin(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireAdmin();
  if (error) return { ok: false, error };
  const { data } = await supabase.auth.getClaims();
  if ((data?.claims?.email as string | undefined)?.toLowerCase() === email.toLowerCase()) {
    return { ok: false, error: "You can't remove yourself." };
  }
  const { error: err } = await supabase.from("admins").delete().eq("email", email.toLowerCase());
  if (err) return { ok: false, error: err.message };
  revalidateAll();
  return { ok: true, data: undefined };
}
