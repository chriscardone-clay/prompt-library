"use client";

import { SKILL_BUCKET } from "@/lib/constants";
import { createClient } from "./client";

/** Object path for a binary skill file: "<prompt id>/<file path>". */
export function skillObjectPath(promptId: string, fileName: string): string {
  const clean = fileName
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  return `${promptId}/${clean}`;
}

/** Upload (or replace) a binary skill file. Returns the object path. */
export async function uploadSkillBinary(
  promptId: string,
  fileName: string,
  bytes: Uint8Array | Blob,
  contentType?: string,
): Promise<string> {
  const supabase = createClient();
  const path = skillObjectPath(promptId, fileName);
  const body = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const { error } = await supabase.storage.from(SKILL_BUCKET).upload(path, body, {
    upsert: true,
    contentType: contentType || "application/octet-stream",
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Fetch a binary skill file's bytes (RLS decides who may). */
export async function downloadSkillBinary(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(SKILL_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed");
  return data;
}
