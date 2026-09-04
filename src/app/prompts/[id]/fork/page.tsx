import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { getCurrentUser, getPrompt } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fork" };

export default async function ForkPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const parent = await getPrompt(id);
  if (!parent) notFound();
  const me = personFromProfile(user);

  return (
    <div className="container">
      <Header user={user} />
      <PromptEditor
        mode="fork"
        promptId={parent.id}
        parentTitle={parent.title}
        initial={{
          kind: parent.kind,
          title: parent.title,
          description: parent.description,
          body: parent.body,
          notes: parent.notes,
          files: parent.files.map((f) => ({ ...f })),
          links: parent.links.map((l) => ({ ...l })),
          apps: parent.apps,
          audience: parent.audience,
          visibility: "public",
          forkNote: "",
          editors: [],
        }}
        owner={me}
        me={me}
        people={[]}
        cancelHref={`/prompts/${parent.id}`}
      />
    </div>
  );
}
