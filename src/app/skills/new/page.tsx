import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { SKILL_TEMPLATE } from "@/lib/constants";
import { activeApps, activeTeams } from "@/lib/catalog";
import { getCatalog, getCurrentUser } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New skill" };

export default async function NewSkillPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const catalog = await getCatalog();
  const me = personFromProfile(user);

  return (
    <div className="container">
      <Header user={user} />
      <PromptEditor
        mode="create"
        initial={{
          kind: "skill",
          title: "",
          description: "",
          body: "",
          notes: "",
          files: [{ name: "SKILL.md", content: SKILL_TEMPLATE }],
          links: [],
          apps: activeApps(catalog).slice(0, 1).map((a) => ({ app: a.name, surfaces: [] })),
          audiences: activeTeams(catalog).slice(0, 1).map((t) => t.name),
          visibility: "public",
          forkNote: "",
          editors: [],
        }}
        owner={me}
        me={me}
        people={[]}
        catalog={catalog}
        cancelHref="/?kind=skills"
      />
    </div>
  );
}
