import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { activeApps, activeTeams } from "@/lib/catalog";
import { getCatalog, getCurrentUser } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New prompt" };

export default async function NewPromptPage() {
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
          kind: "prompt",
          title: "",
          description: "",
          body: "",
          notes: "",
          files: [],
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
        cancelHref="/"
      />
    </div>
  );
}
