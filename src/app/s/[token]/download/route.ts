import { findPublicShare } from "@/lib/shares";

export const dynamic = "force-dynamic";

/** The shared .md exactly as published. Revoked, expired and unknown links all 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await findPublicShare(token);
  if (!share) return new Response("This link isn't available.", { status: 404 });
  const name = share.file.name.split("/").pop() || "workflow.md";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(share.file.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
