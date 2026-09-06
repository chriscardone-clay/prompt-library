import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { DigestPanel } from "@/components/DigestPanel";
import { Header } from "@/components/Header";
import { getCatalog, getCatalogUsage, getCurrentUser, isAdmin } from "@/lib/data";
import { composeDigest, getDigestRuns, getDigestSettings, windowFor, type WindowKind } from "@/lib/digest/run";
import { slackConfigured } from "@/lib/slack";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Non-admins get a 404, not a hint that the page exists.
  if (!(await isAdmin())) notFound();

  const { window } = await searchParams;
  const windowKind: WindowKind = window === "rolling" ? "rolling" : "last";

  const supabase = await createClient();
  const [catalog, usage, adminsRes, settings, runs] = await Promise.all([
    getCatalog(),
    getCatalogUsage(),
    supabase.from("admins").select("email").order("email"),
    getDigestSettings(supabase),
    getDigestRuns(supabase),
  ]);
  const admins = ((adminsRes.data ?? []) as { email: string }[]).map((a) => a.email);

  let preview: { label: string; weekStart: string; message: Awaited<ReturnType<typeof composeDigest>>["message"] } | null = null;
  let previewError: string | null = null;
  try {
    const composed = await composeDigest(supabase, windowFor(windowKind), settings.editors_note);
    preview = { label: composed.window.label, weekStart: composed.window.weekStart, message: composed.message };
  } catch (err) {
    previewError = `Couldn't build the preview: ${err instanceof Error ? err.message : String(err)}`;
  }

  return (
    <div className="container">
      <Header user={user} />
      <AdminPanel catalog={catalog} usage={usage} admins={admins} meEmail={user.email.toLowerCase()} />
      <div style={{ maxWidth: 960, marginTop: 28 }}>
        <DigestPanel
          settings={settings}
          runs={runs}
          preview={preview}
          previewError={previewError}
          windowKind={windowKind}
          slackReady={slackConfigured()}
          meEmail={user.email.toLowerCase()}
        />
      </div>
    </div>
  );
}
