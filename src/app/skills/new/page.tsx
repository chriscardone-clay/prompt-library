import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { SKILL_TEMPLATE } from "@/lib/constants";
import { getCurrentUser } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New skill" };

export default async function NewSkillPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
          apps: [{ app: "Claude", surfaces: [] }],
          audience: "GTM",
          visibility: "public",
          forkNote: "",
          editors: [],
        }}
        owner={me}
        me={me}
        people={[]}
        cancelHref="/?kind=skills"
      />
    </div>
  );
}
