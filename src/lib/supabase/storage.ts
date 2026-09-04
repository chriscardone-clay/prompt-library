"use client";

import { SKILL_BUCKET } from "@/lib/constants";
import { createClient } from "./client";
import { supabaseKey, supabaseUrl } from "./env";

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

/**
 * Upload (or replace) a binary skill file, reporting byte progress (0..1).
 * Uses XMLHttpRequest because fetch can't report upload progress; falls back
 * to the supabase-js client when there's no session token to hand.
 */
export async function uploadSkillBinary(
  promptId: string,
  fileName: string,
  bytes: Uint8Array | Blob,
  contentType?: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const supabase = createClient();
  const path = skillObjectPath(promptId, fileName);
  const body = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const type = contentType || "application/octet-stream";

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    const { error } = await supabase.storage.from(SKILL_BUCKET).upload(path, body, { upsert: true, contentType: type });
    if (error) throw new Error(error.message);
    onProgress?.(1);
    return path;
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${supabaseUrl()}/storage/v1/object/${SKILL_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    xhr.open("POST", url);
    xhr.setRequestHeader("apikey", supabaseKey());
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(e.loaded / e.total, 1));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      let msg = `Upload failed (${xhr.status})`;
      try {
        const j = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        msg = j.message || j.error || msg;
      } catch {
        /* keep default */
      }
      reject(new Error(msg));
    };
    xhr.send(body);
  });
  return path;
}

/** Fetch a binary skill file's bytes (RLS decides who may). */
export async function downloadSkillBinary(path: string): Promise<Blob> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(SKILL_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Download failed");
  return data;
}
