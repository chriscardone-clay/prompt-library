import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { canEdit, getCurrentUser, getPrompt } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit" };

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt) notFound();
  if (!canEdit(prompt, user)) redirect(`/prompts/${id}`);

  return (
    <div className="container">
      <Header user={user} />
      <PromptEditor
        mode="edit"
        promptId={prompt.id}
        initial={{
          kind: prompt.kind,
          title: prompt.title,
          description: prompt.description,
          body: prompt.body,
          notes: prompt.notes,
          files: prompt.files.map((f) => ({ ...f })),
          links: prompt.links.map((l) => ({ ...l })),
          apps: prompt.apps,
          audience: prompt.audience,
          visibility: prompt.visibility,
          forkNote: prompt.forkNote,
          editors: prompt.editors.map((e) => e.email.toLowerCase()),
        }}
        owner={prompt.owner}
        me={personFromProfile(user)}
        people={prompt.editors}
        cancelHref={`/prompts/${prompt.id}`}
      />
    </div>
  );
}
