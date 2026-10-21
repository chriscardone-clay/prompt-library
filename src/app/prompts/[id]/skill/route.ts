import { getCurrentUser, getPrompt } from "@/lib/data";
import { SKILL_BUCKET } from "@/lib/constants";
import { skillSlug } from "@/lib/skills";
import { createClient } from "@/lib/supabase/server";
import { isBinaryFile } from "@/lib/types";
import { type ZipEntry, zipBlob } from "@/lib/zip";

export const dynamic = "force-dynamic";

/**
 * A skill as a .skill bundle (a zip with the skill's folder at the top), the
 * same file the item page's "Download .skill" builds in the browser. Linked
 * from the Claude connector so people can install a skill in one click. Reads
 * go through the signed-in user's client, so RLS decides access.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to clayprompts.com first, then open this link again.", { status: 401 });
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt || prompt.kind !== "skill" || !prompt.files.length) return new Response("Not found.", { status: 404 });

  const supabase = await createClient();
  const slug = skillSlug(prompt.title, prompt.files);
  const entries: ZipEntry[] = [];
  for (const f of prompt.files) {
    if (isBinaryFile(f)) {
      const { data, error } = await supabase.storage.from(SKILL_BUCKET).download(f.path!);
      if (error || !data) return new Response(`Couldn't read ${f.name}.`, { status: 502 });
      entries.push({ name: `${slug}/${f.name}`, content: new Uint8Array(await data.arrayBuffer()) });
    } else {
      entries.push({ name: `${slug}/${f.name}`, content: f.content });
    }
  }
  return new Response(zipBlob(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.skill"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
