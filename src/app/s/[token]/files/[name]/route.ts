import { attachmentResponse } from "@/lib/attachments";
import { SKILL_BUCKET } from "@/lib/constants";
import { findPublicShare, sharePrefix } from "@/lib/shares";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** An attachment included in a publish link. Served only from the share's own storage folder. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  const { token, name } = await params;
  const share = await findPublicShare(token);
  if (!share) return new Response("This link isn't available.", { status: 404 });
  const file = share.attachments.find((f) => f.name === name);
  // Belt and braces: the path must sit under this share's prefix.
  if (!file?.path || !file.path.startsWith(`${sharePrefix(share.id)}/`)) return new Response("Not found.", { status: 404 });
  const { data, error } = await createServiceClient().storage.from(SKILL_BUCKET).download(file.path);
  if (error || !data) return new Response("Not found.", { status: 404 });
  const res = attachmentResponse(data, file);
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
