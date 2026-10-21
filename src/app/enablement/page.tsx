import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Header } from "@/components/Header";
import { ApprovalTag } from "@/components/Tag";
import { approvalRank, DUE_SOON_DAYS, REASON_LABELS } from "@/lib/approval";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { enablementEnabled, getCurrentUser, getPrompt, isAdmin, listPrompts } from "@/lib/data";
import { isReviewer, lastApprovedSnapshot, listOpenReviews, listReviewers, listUseCases, type Review } from "@/lib/enablement";
import { ago } from "@/lib/format";
import type { Prompt } from "@/lib/types";
import { type PaneItem, ReviewersPanel, ReviewPane, UseCasesPanel } from "./EnablementClient";
import styles from "./enablement.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enablement" };

const TABS = ["queue", "due", "approved", "gold", "reviewers"] as const;
type Tab = (typeof TABS)[number];
const KIND_LABEL = { prompt: "Prompt", skill: "Skill", workflow: "Workflow" } as const;

type Search = Promise<{ tab?: string; item?: string }>;

export default async function EnablementPage({ searchParams }: { searchParams: Search }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await enablementEnabled())) notFound();
  const [reviewer, admin] = await Promise.all([isReviewer(), isAdmin()]);
  if (!reviewer && !admin) notFound();

  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : reviewer ? "queue" : "reviewers";

  const [prompts, open, useCases, reviewers] = await Promise.all([
    listPrompts(),
    reviewer ? listOpenReviews() : Promise.resolve([] as Review[]),
    listUseCases(),
    admin ? listReviewers() : Promise.resolve([]),
  ]);
  const byId = new Map(prompts.map((p) => [p.id, p]));
  const soon = Date.now() + DUE_SOON_DAYS * 86400000;
  const openIds = new Set(open.map((r) => r.promptId));
  const due = prompts
    .filter((p) => p.approval.tier !== "none" && p.approval.current && p.approval.dueAt && new Date(p.approval.dueAt).getTime() <= soon && !openIds.has(p.id))
    .sort((a, b) => (a.approval.dueAt ?? "").localeCompare(b.approval.dueAt ?? ""));
  const approved = prompts.filter((p) => p.approval.tier !== "none").sort((a, b) => (b.approval.approvedAt ?? "").localeCompare(a.approval.approvedAt ?? ""));
  const queued = open.filter((r) => byId.has(r.promptId));

  const counts: Record<Tab, number | null> = { queue: queued.length, due: due.length, approved: approved.length, gold: useCases.filter((u) => u.goldPromptId).length, reviewers: null };
  const labels: Record<Tab, string> = { queue: "Needs review", due: "Due", approved: "Approved", gold: "Gold standards", reviewers: "Reviewers" };
  const tabs = TABS.filter((t) => (t === "reviewers" ? admin : reviewer));
  const href = (t: Tab, item?: string) => `/enablement?tab=${t}${item ? `&item=${item}` : ""}`;

  // The item under review: ?item=, else the first in the list.
  const listIds = tab === "queue" ? queued.map((r) => r.promptId) : tab === "due" ? due.map((p) => p.id) : tab === "approved" ? approved.map((p) => p.id) : [];
  const selectedId = reviewer && (sp.item || (tab === "queue" || tab === "due" || tab === "approved" ? listIds[0] : undefined));
  const selected = selectedId ? (byId.get(selectedId) ?? (await getPrompt(selectedId))) : null;
  const request = selected ? (open.find((r) => r.promptId === selected.id) ?? null) : null;
  const snapshot = selected && selected.approval.tier !== "none" ? await lastApprovedSnapshot(selected.id) : null;
  const ucOptions = useCases.filter((u) => !u.archived).map((u) => ({ id: u.id, name: u.name, goldTitle: u.goldPromptId ? (byId.get(u.goldPromptId)?.title ?? "another item") : null }));

  return (
    <div className="container">
      <Header user={user} active="enablement" />
      <section className={styles.section}>
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Enablement</span>
          <h1 className="display-lg">{tab === "gold" ? "Gold standards" : tab === "reviewers" ? "Reviewers" : "Review queue"}</h1>
          <p className="muted" style={{ maxWidth: "70ch" }}>
            {reviewer
              ? "Approved items rank higher in Discover, search, the Claude connector and the Slack assistant. Decisions are added to the item's history and sent to its owner in Slack."
              : "You're an admin, not a reviewer. Add the people on the Enablement team here, including yourself if you review."}
          </p>
        </div>

        <nav className={styles.tabs} aria-label="Enablement">
          {tabs.map((t) => (
            <Link key={t} href={href(t)} className={styles.tab} aria-current={t === tab ? "page" : undefined}>
              {labels[t]}
              {counts[t] !== null ? <span className={styles.count}>{counts[t]}</span> : null}
            </Link>
          ))}
        </nav>

        {tab === "reviewers" ? (
          <ReviewersPanel reviewers={reviewers} domain={ALLOWED_EMAIL_DOMAIN} />
        ) : tab === "gold" ? (
          <UseCasesPanel
            useCases={useCases.map((u) => ({
              id: u.id,
              name: u.name,
              description: u.description,
              archived: u.archived,
              gold: u.goldPromptId && byId.get(u.goldPromptId) ? { id: u.goldPromptId, title: byId.get(u.goldPromptId)!.title } : null,
              candidates: prompts
                .filter((p) => approvalRank(p.approval) >= 1 && p.id !== u.goldPromptId && (!p.approval.useCaseId || p.approval.useCaseId === u.id))
                .map((p) => ({ id: p.id, title: p.title })),
            }))}
          />
        ) : (
          <div className={styles.queue}>
            <div className={styles.list} role="list">
              {tab === "queue" ? (
                queued.length ? (
                  queued.map((r) => <QueueItem key={r.id} p={byId.get(r.promptId)!} on={r.promptId === selected?.id} href={href(tab, r.promptId)} meta={`${r.requestedBy?.name ?? "Someone"} · ${REASON_LABELS[r.reason]} · ${ago(r.createdAt)}`} />)
                ) : (
                  <div className={styles.empty}>Nothing waiting. New requests show up here and in Slack.</div>
                )
              ) : (tab === "due" ? due : approved).length ? (
                (tab === "due" ? due : approved).map((p) => (
                  <QueueItem
                    key={p.id}
                    p={p}
                    on={p.id === selected?.id}
                    href={href(tab, p.id)}
                    meta={tab === "due" ? `Due ${ago(p.approval.dueAt!)}` : `${p.approval.approvedBy?.name ?? "Enablement"} · ${ago(p.approval.approvedAt ?? p.updatedAt)}`}
                  />
                ))
              ) : (
                <div className={styles.empty}>{tab === "due" ? `Nothing due in the next ${DUE_SOON_DAYS} days.` : "Nothing approved yet."}</div>
              )}
            </div>

            {selected ? (
              <section className={styles.pane} aria-label={`Review ${selected.title}`}>
                <div className={styles.paneHead}>
                  <div className="row gap-2 wrap">
                    <span className="tag">{KIND_LABEL[selected.kind]}</span>
                    <ApprovalTag approval={selected.approval} />
                    {selected.audiences.map((a) => (
                      <span key={a} className="tag tag-light">
                        {a}
                      </span>
                    ))}
                    <div className="grow" />
                    <Link href={`/prompts/${selected.id}`} className="btn btn-outline btn-sm">
                      Open item
                    </Link>
                  </div>
                  <h2 className="display-md">{selected.title}</h2>
                  <div className="row gap-2 small muted">
                    <Avatar person={selected.owner} size={22} />
                    {selected.owner.name} · updated {ago(selected.updatedAt)}
                    {selected.visibility !== "public" ? " · private (can't be approved)" : ""}
                  </div>
                  {selected.description ? <p className="muted">{selected.description}</p> : null}
                </div>
                {request?.requestNote ? (
                  <div className={styles.note}>
                    <span className="eyebrow">From {request.requestedBy?.name ?? "the owner"}</span>
                    {request.requestNote}
                  </div>
                ) : null}
                <ReviewPane
                  key={selected.id}
                  item={toPane(selected)}
                  snapshot={snapshot?.body ?? null}
                  useCases={ucOptions}
                  defaultUseCase={request?.useCaseId ?? selected.approval.useCaseId}
                />
              </section>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function toPane(p: Prompt): PaneItem {
  return { id: p.id, title: p.title, body: p.body, approved: p.approval.tier !== "none", tier: p.approval.tier, useCaseId: p.approval.useCaseId };
}

function QueueItem({ p, on, href, meta }: { p: Prompt; on: boolean; href: string; meta: string }) {
  return (
    <Link href={href} className={styles.item} aria-current={on ? "true" : undefined} role="listitem">
      <div className="row gap-2 wrap">
        <span className="tag tag-light">{KIND_LABEL[p.kind]}</span>
        <ApprovalTag approval={p.approval} short />
      </div>
      <span className={styles.itemTitle}>{p.title}</span>
      <span className="tiny muted">{meta}</span>
    </Link>
  );
}
