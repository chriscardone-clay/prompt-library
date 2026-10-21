import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { canEdit, getCatalog, getCurrentUser, getPrompt } from "@/lib/data";
import { approvalRank } from "@/lib/approval";
import { personFromProfile } from "@/lib/people";
import { listShares } from "@/lib/shares";
import { packDocFiles } from "@/lib/workflows";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit" };

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const catalog = await getCatalog();
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt) notFound();
  if (!canEdit(prompt, user)) redirect(`/prompts/${id}`);
  const activeShares = prompt.kind === "workflow" ? (await listShares(prompt.id)).filter((s) => !s.expired).length : 0;

  return (
    <div className="container">
      <Header user={user} />
      {approvalRank(prompt.approval) > 0 ? (
        <div className="slab" style={{ gap: 4, marginTop: 24 }} role="note">
          <strong className="small">
            {prompt.approval.tier === "gold" ? "This is a gold standard." : "Enablement approved this version."} Changes to the{" "}
            {prompt.kind === "prompt" ? "prompt text" : prompt.kind === "skill" ? "skill files" : "workflow .md"} need a re-review.
          </strong>
          <span className="small muted">
            Saving new content turns the Enablement boost off and sends it back to their queue. Title, description, tags and How to use don&apos;t.
          </span>
        </div>
      ) : null}
      <PromptEditor
        mode="edit"
        promptId={prompt.id}
        initial={{
          kind: prompt.kind,
          title: prompt.title,
          description: prompt.description,
          body: prompt.body,
          notes: prompt.notes,
          files: prompt.kind === "workflow" ? packDocFiles(prompt.files) : prompt.files.map((f) => ({ ...f })),
          links: prompt.links.map((l) => ({ ...l })),
          workflow: { ...prompt.workflow },
          apps: prompt.apps,
          audiences: prompt.audiences,
          visibility: prompt.visibility,
          forkNote: prompt.forkNote,
          editors: prompt.editors.map((e) => e.email.toLowerCase()),
        }}
        owner={prompt.owner}
        me={personFromProfile(user)}
        people={prompt.editors}
        catalog={catalog}
        cancelHref={`/prompts/${prompt.id}`}
        activeShares={activeShares}
      />
    </div>
  );
}
