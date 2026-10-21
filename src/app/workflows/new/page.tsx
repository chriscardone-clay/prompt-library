import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { activeApps, activeTeams } from "@/lib/catalog";
import { WORKFLOW_APP } from "@/lib/constants";
import { getCatalog, getCurrentUser, workflowsEnabled } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New workflow" };

export default async function NewWorkflowPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await workflowsEnabled())) notFound();
  const catalog = await getCatalog();
  const me = personFromProfile(user);
  const apps = activeApps(catalog);
  const app = apps.find((a) => a.name === WORKFLOW_APP) ?? apps[0];
  const teams = activeTeams(catalog);
  const team = teams.find((t) => t.name === "Services") ?? teams[0];

  return (
    <div className="container">
      <Header user={user} />
      <PromptEditor
        mode="create"
        initial={{
          kind: "workflow",
          title: "",
          description: "",
          body: "",
          notes: "",
          files: [],
          links: [],
          workflow: { trigger: "", stage: "draft", integrations: [], customerReady: false },
          apps: app ? [{ app: app.name, surfaces: [], model: "", required: false }] : [],
          audiences: team ? [team.name] : [],
          visibility: "public",
          forkNote: "",
          editors: [],
        }}
        owner={me}
        me={me}
        people={[]}
        catalog={catalog}
        cancelHref="/?kind=workflows"
      />
    </div>
  );
}
