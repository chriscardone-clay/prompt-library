import type { NextRequest } from "next/server";
import { canEdit, getCurrentUser, getPrompt, listVersions } from "@/lib/data";
import { workflowDoc } from "@/lib/workflows";

export const dynamic = "force-dynamic";

/**
 * A workflow's .md exactly as stored: same text, same file name. `?version=`
 * serves an earlier version (owners and editors only, like version history).
 * Reads go through the signed-in user's client, so RLS decides access.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt || prompt.kind !== "workflow") return new Response("Not found.", { status: 404 });

  let files = prompt.files;
  const versionId = req.nextUrl.searchParams.get("version");
  if (versionId) {
    if (!canEdit(prompt, user)) return new Response("Not found.", { status: 404 });
    const version = (await listVersions(id)).find((v) => v.id === versionId);
    if (!version) return new Response("Not found.", { status: 404 });
    files = version.files;
  }
  const doc = workflowDoc(files);
  if (!doc) return new Response("Not found.", { status: 404 });

  const name = doc.name.split("/").pop() || "workflow.md";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(doc.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
