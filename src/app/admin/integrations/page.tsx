import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { IntegrationsPanel } from "@/components/IntegrationsPanel";
import { canManageIntegrations, getCatalog, getCurrentUser, isAdmin, workflowsEnabled } from "@/lib/data";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await workflowsEnabled()) || !(await canManageIntegrations())) notFound();

  const [catalog, admin] = await Promise.all([getCatalog(), isAdmin()]);
  const supabase = await createClient();

  // Usage counts cover private workflows too, so read them with the service
  // client when it's configured (names and counts only, nothing else leaves).
  let usageClient: typeof supabase = supabase;
  try {
    usageClient = createServiceClient() as unknown as typeof supabase;
  } catch {
    /* fall back to what the maintainer can see */
  }
  const { data: rows } = await usageClient.from("prompts").select("integrations").eq("kind", "workflow");
  const usage: Record<string, number> = {};
  for (const r of (rows ?? []) as { integrations: string[] | null }[]) {
    for (const i of r.integrations ?? []) usage[i] = (usage[i] ?? 0) + 1;
  }

  const maintainers = admin
    ? (((await supabase.from("catalog_managers").select("email").order("email")).data ?? []) as { email: string }[]).map((m) => m.email)
    : null;

  return (
    <div className="container">
      <Header user={user} />
      <IntegrationsPanel
        integrations={catalog.integrations ?? []}
        usage={usage}
        maintainers={maintainers}
      />
    </div>
  );
}
