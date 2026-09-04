import { ArrowLeft, GitFork, PencilSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { FeedbackSection } from "@/components/FeedbackSection";
import { Header } from "@/components/Header";
import { PromptBody } from "@/components/PromptBody";
import { PromptNotes } from "@/components/PromptNotes";
import { AppTag, AudienceTag, PrivateTag } from "@/components/Tag";
import { ToastFromQuery } from "@/components/Toast";
import { VariantsTree } from "@/components/VariantsTree";
import { VersionHistory } from "@/components/VersionHistory";
import { VoteButton } from "@/components/VoteButton";
import {
  canEdit,
  getCurrentUser,
  getPrompt,
  listFeedback,
  listPromptNodes,
  listVersions,
} from "@/lib/data";
import { ago } from "@/lib/format";
import type { Person, Profile, Prompt, PromptNode } from "@/lib/types";
import styles from "./detail.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const p = await getPrompt(id);
  return { title: p?.title ?? "Prompt" };
}

export default async function PromptPage({ params }: { params: Params }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const prompt = await getPrompt(id);
  if (!prompt) notFound();

  const editable = canEdit(prompt, user);
  const [nodes, feedback, versions] = await Promise.all([
    listPromptNodes(),
    listFeedback(id),
    editable ? listVersions(id) : Promise.resolve([]),
  ]);
  const parent = prompt.parentId ? nodes.find((n) => n.id === prompt.parentId) ?? null : null;
  const lastEditor = resolveLastEditor(prompt, nodes, user);

  return (
    <div className="container">
      <Header user={user} />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>

      <section className={styles.section}>
        <Link href="/" className="back-link">
          <ArrowLeft weight="bold" size={13} />
          Back
        </Link>

        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.tags}>
              {prompt.apps.map((a) => (
                <AppTag key={a.app} app={a} />
              ))}
              <AudienceTag audience={prompt.audience} />
              {prompt.visibility === "private" ? <PrivateTag /> : null}
            </div>
            <h1 className="display-lg">{prompt.title}</h1>
            {prompt.description ? <p className={styles.lede}>{prompt.description}</p> : null}
            {parent ? (
              <div className={styles.forkNote}>
                <div className={styles.forkNoteHead}>
                  <GitFork weight="bold" size={14} />
                  Forked from{" "}
                  <Link href={`/prompts/${parent.id}`} className={styles.forkParent}>
                    {parent.title}
                  </Link>
                </div>
                {prompt.forkNote ? <div className={styles.forkNoteBody}>{prompt.forkNote}</div> : null}
              </div>
            ) : null}
            <div className={styles.byline}>
              <Avatar person={prompt.owner} size={28} />
              <span className={styles.bylineName}>{prompt.owner.name}</span>
              <span>·</span>
              <span>created {ago(prompt.createdAt)}</span>
              <span>·</span>
              <span>updated {ago(prompt.updatedAt)}</span>
            </div>
          </div>
          <div className={styles.headActions}>
            <VoteButton
              promptId={prompt.id}
              count={prompt.upvoteUserIds.length}
              voted={prompt.upvoteUserIds.includes(user.id)}
              size="md"
              surface="page"
            />
            <Link href={`/prompts/${prompt.id}/fork`} className="btn btn-outline">
              <GitFork weight="bold" size={15} />
              Fork
            </Link>
            {editable ? (
              <Link href={`/prompts/${prompt.id}/edit`} className="btn btn-outline">
                <PencilSimple weight="bold" size={15} />
                Edit
              </Link>
            ) : null}
          </div>
        </div>

        <div className={styles.columns}>
          <div className={styles.main}>
            <PromptBody promptId={prompt.id} body={prompt.body} />
            <PromptNotes notes={prompt.notes} />
          </div>

          <aside className={styles.side}>
            <VariantsTree nodes={nodes} currentId={prompt.id} />

            <div className="slab" style={{ gap: 12 }}>
              <div className="eyebrow">Who can edit</div>
              <div className={styles.people}>
                <PersonRow person={prompt.owner} role="Owner" />
                {prompt.editors.map((e) => (
                  <PersonRow key={e.email} person={e} role="Editor" />
                ))}
              </div>
            </div>

            {editable ? (
              <VersionHistory
                versions={versions}
                currentLabel={`Version ${versions.length + 1} · current`}
                currentSub={`${lastEditor.name} · ${ago(prompt.updatedAt)}`}
              />
            ) : null}
          </aside>
        </div>

        <FeedbackSection
          promptId={prompt.id}
          feedback={feedback}
          me={{ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url }}
          canManage={editable}
        />
      </section>
    </div>
  );
}

/** Whoever saved the current version: owner, an editor, the viewer, or someone who owns another prompt. */
function resolveLastEditor(
  prompt: Prompt,
  nodes: PromptNode[],
  user: Profile,
): Person {
  const id = prompt.lastEditedBy;
  if (!id || id === prompt.ownerId) return prompt.owner;
  const editor = prompt.editors.find((e) => e.id === id);
  if (editor) return editor;
  if (id === user.id) {
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url };
  }
  const other = nodes.find((n) => n.owner.id === id)?.owner;
  return other ?? prompt.owner;
}

function PersonRow({
  person,
  role,
}: {
  person: { id: string | null; email: string; name: string; avatarUrl: string | null };
  role: string;
}) {
  return (
    <div className={styles.person}>
      <Avatar person={person} size={26} />
      <div className={styles.personText}>
        <span className={styles.personName}>{person.name}</span>
        <span className={styles.personRole}>
          {role}
          {person.id ? "" : " · invited"}
        </span>
      </div>
    </div>
  );
}
