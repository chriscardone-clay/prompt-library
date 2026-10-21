import { SKILL_BUCKET } from "@/lib/constants";
import { getCurrentUser, getPrompt } from "@/lib/data";
import { attachmentResponse } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/server";
import { workflowAttachments } from "@/lib/workflows";

export const dynamic = "force-dynamic";

/** A workflow attachment, read through the signed-in user's client so Storage RLS decides access. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id, name } = await params;
  const prompt = await getPrompt(id);
  if (!prompt || prompt.kind !== "workflow") return new Response("Not found.", { status: 404 });
  const file = workflowAttachments(prompt.files).find((f) => f.name === name);
  if (!file?.path) return new Response("Not found.", { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(SKILL_BUCKET).download(file.path);
  if (error || !data) return new Response("Not found.", { status: 404 });
  return attachmentResponse(data, file);
}
