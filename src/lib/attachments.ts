import type { SkillFile } from "./types";

/**
 * A download response for a stored attachment. Always served as an
 * attachment with nosniff, so an uploaded HTML or SVG file can't run in the
 * app's origin.
 */
export function attachmentResponse(body: Blob, file: SkillFile): Response {
  const name = file.name.split("/").pop() || "file";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": file.type && /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
