"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/app/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { canManageIntegrations, isAdmin } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 40;

/** Admins and Workflow maintainers; RLS (can_manage_integrations) enforces the same. */
async function requireManager() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  if (!(await canManageIntegrations())) return { supabase, error: "Only the Workflows team and admins can change integrations." as const };
  return { supabase, error: null, email: String(data.claims.email ?? "").toLowerCase() };
}

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s && s.length <= NAME_MAX ? s : null;
}

export interface IntegrationInput {
  /** Set when renaming or editing an existing integration. */
  originalName?: string;
  name: string;
  color: string;
  archived?: boolean;
}

export async function saveIntegration(input: IntegrationInput): Promise<ActionResult> {
  const { supabase, error } = await requireManager();
  if (error) return { ok: false, error };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: `Names are 1–${NAME_MAX} characters.` };
  if (!HEX.test(input.color)) return { ok: false, error: "Colours are hex, like #429EFF." };
  const row = { name, color: input.color.toUpperCase(), archived: !!input.archived };
  if (input.originalName) {
    // Renames cascade into every workflow that uses the old name (integrations_after_update).
    const { error: e } = await supabase.from("integrations").update(row).eq("name", input.originalName);
    if (e) return { ok: false, error: e.code === "23505" ? `"${name}" is already on the list.` : e.message };
  } else {
    const { data: last } = await supabase.from("integrations").select("position").order("position", { ascending: false }).limit(1);
    const position = ((last?.[0] as { position: number } | undefined)?.position ?? 0) + 1;
    const { error: e } = await supabase.from("integrations").insert({ ...row, position });
    if (e) return { ok: false, error: e.code === "23505" ? `"${name}" is already on the list.` : e.message };
  }
  return done();
}

export async function deleteIntegration(name: string): Promise<ActionResult> {
  const { supabase, error } = await requireManager();
  if (error) return { ok: false, error };
  // Refused by integrations_before_delete while any workflow uses it.
  const { error: e } = await supabase.from("integrations").delete().eq("name", name);
  if (e) return { ok: false, error: e.message };
  return done();
}

export async function reorderIntegrations(names: string[]): Promise<ActionResult> {
  const { supabase, error } = await requireManager();
  if (error) return { ok: false, error };
  for (let i = 0; i < names.length; i++) {
    const { error: e } = await supabase.from("integrations").update({ position: i + 1 }).eq("name", names[i]);
    if (e) return { ok: false, error: e.message };
  }
  return done();
}

export async function addMaintainer(email: string): Promise<ActionResult> {
  const { supabase, error, email: me } = await requireManager();
  if (error) return { ok: false, error };
  if (!(await isAdmin())) return { ok: false, error: "Only admins can add maintainers." };
  const e = email.trim().toLowerCase();
  if (!e.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) return { ok: false, error: `Maintainers need an @${ALLOWED_EMAIL_DOMAIN} address.` };
  const { error: err } = await supabase
    .from("catalog_managers")
    .upsert({ email: e, scope: "integrations", added_by: me }, { onConflict: "email" });
  if (err) return { ok: false, error: err.message };
  return done();
}

export async function removeMaintainer(email: string): Promise<ActionResult> {
  const { supabase, error } = await requireManager();
  if (error) return { ok: false, error };
  if (!(await isAdmin())) return { ok: false, error: "Only admins can remove maintainers." };
  const { error: err } = await supabase.from("catalog_managers").delete().eq("email", email.toLowerCase());
  if (err) return { ok: false, error: err.message };
  return done();
}
