import { ArrowLeft, CheckCircle, DownloadSimple, GitFork, LinkSimple, PencilSimple, Warning } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/Avatar";
import { DeleteButton } from "@/components/DeleteButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { FeedbackSection } from "@/components/FeedbackSection";
import { SharePanel } from "@/components/SharePanel";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { WorkflowDoc } from "@/components/WorkflowDoc";
import { Header } from "@/components/Header";
import { PromptBody } from "@/components/PromptBody";
import { PromptNotes } from "@/components/PromptNotes";
import { SkillFiles } from "@/components/SkillFiles";
import { SkillInstall } from "@/components/SkillInstall";
import { SkillLinks } from "@/components/SkillLinks";
import {
  AppTag,
  AudienceTag,
  IntegrationTag,
  OriginTag,
  PrivateTag,
  ReadyTag,
  SkillTag,
  StageTag,
  TriggerTag,
  WorkflowTag,
  appLabel,
} from "@/components/Tag";
import { appTone, catalogIntegration, REQUIRED_TONE, toneStyle } from "@/lib/catalog";
import { STAGE_LABELS, TRIGGER_LABELS } from "@/lib/constants";
import { tableOfContents } from "@/lib/markdown";
import { listShares } from "@/lib/shares";
import { getRequestOrigin } from "@/lib/site";
import { fileBytes, formatBytes, skillSlug } from "@/lib/skills";
import { scanForInternal, workflowAttachments, workflowDoc } from "@/lib/workflows";
import { shouldNudgeToSlack } from "@/lib/slackNudge";
import { ToastFromQuery } from "@/components/Toast";
import { VariantsTree } from "@/components/VariantsTree";
import { VersionHistory } from "@/components/VersionHistory";
import { VoteButton } from "@/components/VoteButton";
import {
  canEdit,
  getCatalog,
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
  const [nodes, feedback, versions, catalog] = await Promise.all([
    listPromptNodes(),
    listFeedback(id),
    editable ? listVersions(id) : Promise.resolve([]),
    getCatalog(),
  ]);
  const parent = prompt.parentId ? nodes.find((n) => n.id === prompt.parentId) ?? null : null;
  const lastEditor = resolveLastEditor(prompt, nodes, user);
  const isWf = prompt.kind === "workflow";
  const doc = isWf ? workflowDoc(prompt.files) : undefined;
  const toc = doc ? tableOfContents(doc.content) : [];
  // The customer-ready check is for the people who can fix the doc.
  const findings = doc && editable ? scanForInternal(doc.content) : [];
  const [shares, origin] = isWf && editable ? await Promise.all([listShares(prompt.id), getRequestOrigin()]) : [[], ""];

  const nudge = await shouldNudgeToSlack(user);
  return (
    <div className="container">
      <Header user={user} slackNudge={nudge} />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>

      <section className={styles.section}>
        <Link href={`/?kind=${prompt.kind}s`} className="back-link">
          <ArrowLeft weight="bold" size={13} />
          Back
        </Link>

        <div className={styles.head}>
          <div className={styles.headMain}>
            <div className={styles.tags}>
              {prompt.kind === "skill" ? <SkillTag /> : null}
              {isWf ? (
                <>
                  <WorkflowTag />
                  <OriginTag adapted={!!prompt.parentId} />
                  <TriggerTag trigger={prompt.workflow.trigger} />
                  <StageTag stage={prompt.workflow.stage} />
                  <ReadyTag ready={prompt.workflow.customerReady} showNotReady={editable} />
                </>
              ) : null}
              {prompt.apps.map((a) => (
                <AppTag key={a.app} app={a} tone={appTone(catalog, a.app)} />
              ))}
              {prompt.audiences.map((a) => (
                <AudienceTag key={a} audience={a} />
              ))}
              {prompt.visibility === "private" ? <PrivateTag /> : null}
            </div>
            <h1 className="display-lg">{prompt.title}</h1>
            {prompt.description ? <p className={styles.lede}>{prompt.description}</p> : null}
            {parent ? (
              <div className={styles.forkNote}>
                <div className={styles.forkNoteHead}>
                  <GitFork weight="bold" size={14} />
                  {isWf ? "Adapted from" : "Forked from"}{" "}
                  <Link href={`/prompts/${parent.id}`} className={styles.forkParent}>
                    {parent.title}
                  </Link>
                </div>
                {prompt.forkNote ? (
                  <div className={styles.forkNoteBody}>
                    {isWf ? (
                      <>
                        Adapted for <strong>{prompt.forkNote}</strong>
                      </>
                    ) : (
                      prompt.forkNote
                    )}
                  </div>
                ) : null}
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
            <FavoriteButton promptId={prompt.id} favorited={prompt.favoritedBy.includes(user.id)} variant="pill" />
            <Link href={`/prompts/${prompt.id}/fork`} className="btn btn-outline">
              <GitFork weight="bold" size={15} />
              {isWf ? "Adapt" : "Fork"}
            </Link>
            {isWf && editable ? (
              <a href="#links" className="btn btn-outline">
                <LinkSimple weight="bold" size={15} />
                Publish link
              </a>
            ) : null}
            {editable ? (
              <Link href={`/prompts/${prompt.id}/edit`} className="btn btn-outline">
                <PencilSimple weight="bold" size={15} />
                Edit
              </Link>
            ) : null}
            {prompt.ownerId === user.id ? (
              <DeleteButton promptId={prompt.id} title={prompt.title} returnHref="/mine" />
            ) : null}
          </div>
        </div>

        <div className={styles.columns}>
          <div className={styles.main}>
            {isWf ? (
              <>
                {doc ? (
                  <WorkflowDoc
                    name={doc.name}
                    bytes={fileBytes(doc)}
                    source={doc.content}
                    downloadHref={`/prompts/${prompt.id}/download`}
                  >
                    <MarkdownDoc md={doc.content} />
                  </WorkflowDoc>
                ) : null}
                {workflowAttachments(prompt.files).length ? (
                  <div className="slab" style={{ gap: 10 }}>
                    <div className="section-title">Attachments</div>
                    <div className={styles.findings}>
                      {workflowAttachments(prompt.files).map((f) => (
                        <a key={f.name} href={`/prompts/${prompt.id}/files/${encodeURIComponent(f.name)}`} className={styles.finding} download={f.name}>
                          <DownloadSimple weight="bold" size={14} />
                          <span className="grow truncate">{f.name}</span>
                          <span className="tiny muted">{formatBytes(f.size ?? 0)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                <SkillLinks links={prompt.links} kind="workflow" />
              </>
            ) : prompt.kind === "skill" ? (
              <>
                <SkillLinks links={prompt.links} />
                <SkillFiles files={prompt.files} slug={skillSlug(prompt.title, prompt.files)} />
                {prompt.files.length ? <SkillInstall apps={prompt.apps} catalog={catalog} /> : null}
              </>
            ) : (
              <>
                <SkillLinks links={prompt.links} kind="prompt" />
                <PromptBody promptId={prompt.id} body={prompt.body} />
              </>
            )}
            <PromptNotes notes={prompt.notes} />
          </div>

          <aside className={styles.side}>
            {isWf && toc.length ? (
              <nav className="slab" style={{ gap: 10 }} aria-label="Contents">
                <div className="section-title">Contents</div>
                <div className={styles.toc}>
                  {toc.map((h, i) => (
                    <a key={`${h.id}-${i}`} href={`#${h.id}`} data-depth={h.depth}>
                      {h.text}
                    </a>
                  ))}
                </div>
              </nav>
            ) : null}
            {isWf ? (
              <div className="slab" style={{ gap: 12 }}>
                <div className="section-title">Workflow</div>
                <div className={styles.facts}>
                  <span className="muted">Trigger</span>
                  <span>{prompt.workflow.trigger ? TRIGGER_LABELS[prompt.workflow.trigger] : "Not set"}</span>
                  <span className="muted">Stage</span>
                  <span>{prompt.workflow.stage ? STAGE_LABELS[prompt.workflow.stage] : "Draft"}</span>
                  <span className="muted">Customer-ready</span>
                  <span>{prompt.workflow.customerReady ? "Yes" : "Not yet"}</span>
                </div>
                {prompt.workflow.integrations.length ? (
                  <div className={styles.tags}>
                    {prompt.workflow.integrations.map((i) => (
                      <IntegrationTag key={i} name={i} color={catalogIntegration(catalog, i)?.color} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {isWf && editable && doc ? (
              <SharePanel
                promptId={prompt.id}
                customerReady={prompt.workflow.customerReady}
                attachments={workflowAttachments(prompt.files).map((f) => f.name)}
                shares={shares}
                updatedAt={prompt.updatedAt}
                origin={origin}
              />
            ) : null}
            {isWf && editable && doc ? (
              <div className="slab" style={{ gap: 10 }}>
                <div className="section-title">Before you send it</div>
                {findings.length ? (
                  <>
                    <div className="small muted">
                      {findings.length} thing{findings.length === 1 ? "" : "s"} in the .md that may not belong outside Clay.
                      Only you and your editors see this.
                    </div>
                    <div className={styles.findings}>
                      {findings.slice(0, 10).map((f, i) => (
                        <a key={i} href={`#L${f.line}`} className={styles.finding}>
                          <Warning weight="bold" size={14} className={styles.findingIcon} />
                          <span>
                            <strong>Line {f.line}</strong> · {f.message}
                          </span>
                        </a>
                      ))}
                      {findings.length > 10 ? <span className="tiny muted">…and {findings.length - 10} more.</span> : null}
                    </div>
                  </>
                ) : (
                  <div className={styles.finding}>
                    <CheckCircle weight="bold" size={14} className={styles.okIcon} />
                    <span className="small">No internal emails, record IDs, hostnames, Slack IDs or credentials found.</span>
                  </div>
                )}
              </div>
            ) : null}
            {prompt.apps.some((a) => a.model) ? (
              <div className="slab" style={{ gap: 14 }}>
                <div className="section-title">Model</div>
                <div className={styles.modelList}>
                  {prompt.apps
                    .filter((a) => a.model)
                    .map((a) => (
                      <div key={a.app} className={styles.modelCard}>
                        <div className={styles.modelHead}>
                          <span className={styles.modelName}>{a.model}</span>
                          {a.required ? (
                            <span className="tag tone" style={toneStyle(REQUIRED_TONE)}>
                              Required
                            </span>
                          ) : (
                            <span className="tag tag-muted">Recommended</span>
                          )}
                        </div>
                        <span className={styles.modelApp}>{appLabel(a)}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
            <VariantsTree
              nodes={nodes}
              currentId={prompt.id}
              noun={prompt.kind}
              title={isWf ? "Adaptations" : "Variants"}
              forkNoun={isWf ? "adaptation" : "fork"}
            />

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
                downloadHref={isWf ? `/prompts/${prompt.id}/download` : undefined}
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
