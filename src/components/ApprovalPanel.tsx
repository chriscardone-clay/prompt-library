import { ArrowsClockwise, CheckCircle, Circle, ClockCountdown, Medal, PencilSimple, ShieldCheck, XCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { approvalRank, RUBRIC, STATUS_LABELS, type ReviewStatus } from "@/lib/approval";
import type { Review, UseCase } from "@/lib/enablement";
import { ago } from "@/lib/format";
import type { Prompt } from "@/lib/types";
import { RequestReviewButton, WithdrawReviewButton } from "./RequestReview";
import styles from "./Approval.module.css";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

interface Props {
  prompt: Prompt;
  /** Newest first. */
  reviews: Review[];
  editable: boolean;
  reviewer: boolean;
  useCases: UseCase[];
}

/** The latest decision, for owners: changes requested / not approved, unless something newer replaced it. */
function latestDecision(reviews: Review[]): Review | null {
  return reviews.find((r) => r.status !== "requested" && r.status !== "withdrawn") ?? null;
}

/** Under the description on the item page: what Enablement says about it. */
export function ApprovalBanner({ prompt, reviews, editable }: Pick<Props, "prompt" | "reviews" | "editable">) {
  const a = prompt.approval;
  const open = reviews.find((r) => r.status === "requested");
  const last = latestDecision(reviews);

  if (a.tier !== "none" && a.current) {
    const gold = a.tier === "gold";
    return (
      <div className={styles.banner} data-tone={gold ? "gold" : "approved"} role="status">
        <span className={styles.bannerIcon} style={{ color: gold ? "#a2740f" : "var(--ok-fg)" }}>
          {gold ? <Medal weight="bold" size={18} /> : <ShieldCheck weight="bold" size={18} />}
        </span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>{gold ? `Gold standard${a.useCase ? ` for ${a.useCase}` : ""}` : "Enablement approved"}</span>
          <span className="small">
            {gold ? "Enablement's recommended starting point. " : ""}
            {a.approvedBy ? `Reviewed by ${a.approvedBy.name}` : "Reviewed"}
            {a.approvedAt ? ` on ${day(a.approvedAt)}` : ""}.{a.dueAt ? ` Next review by ${day(a.dueAt)}.` : ""}
          </span>
        </div>
        <a href="#enablement" className="btn btn-outline btn-sm">
          What was checked
        </a>
      </div>
    );
  }

  if (a.tier !== "none" && !a.current) {
    return (
      <div className={styles.banner} data-tone={editable ? "warn" : undefined} role="status">
        <span className={styles.bannerIcon}>
          <ArrowsClockwise weight="bold" size={18} />
        </span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>{editable ? "Re-review needed" : "Approved earlier version"}</span>
          <span className="small">
            {editable
              ? "You changed it after Enablement approved it. It ranks like any other item until it's re-approved. It's back in their queue."
              : "Enablement approved an earlier version. It has changed since and is waiting for a re-review."}
          </span>
        </div>
      </div>
    );
  }

  if (!editable) return null;
  if (open) {
    return (
      <div className={styles.banner} role="status">
        <span className={styles.bannerIcon} style={{ color: "var(--info-fg)" }}>
          <ClockCountdown weight="bold" size={18} />
        </span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>In review with Enablement</span>
          <span className="small">Requested {ago(open.createdAt)}. You&apos;ll get a Slack DM when it&apos;s decided.</span>
        </div>
        <WithdrawReviewButton promptId={prompt.id} />
      </div>
    );
  }
  if (last && (last.status === "changes_requested" || last.status === "declined" || last.status === "revoked")) {
    return (
      <div className={styles.banner} data-tone="warn" role="status">
        <span className={styles.bannerIcon} style={{ color: "var(--warn-fg)" }}>
          {last.status === "changes_requested" ? <PencilSimple weight="bold" size={18} /> : <XCircle weight="bold" size={18} />}
        </span>
        <div className={styles.bannerText}>
          <span className={styles.bannerTitle}>{STATUS_LABELS[last.status]}</span>
          {last.decisionNote ? (
            <span className={styles.quote}>
              “{last.decisionNote}”{last.reviewer ? ` — ${last.reviewer.name}` : ""}
            </span>
          ) : null}
        </div>
        {last.status === "changes_requested" ? (
          <Link href={`/prompts/${prompt.id}/edit`} className="btn btn-outline btn-sm">
            Edit and resubmit
          </Link>
        ) : null}
      </div>
    );
  }
  return null;
}

/** Side panel: the review itself, what it's built from, and the history. */
export function ApprovalPanel({ prompt, reviews, editable, reviewer, useCases, goldParent }: Props & { goldParent: { id: string; title: string } | null }) {
  const a = prompt.approval;
  const approvedReview = reviews.find((r) => r.status === "approved");
  const open = reviews.find((r) => r.status === "requested");
  const history = reviews.filter((r) => r.status !== "withdrawn").slice(0, 6);
  const canRequest = editable && prompt.visibility === "public" && !open && !(a.tier !== "none" && a.current);
  const status =
    a.tier !== "none" ? (a.current ? (a.tier === "gold" ? "Gold standard" : "Approved") : "Re-review needed") : open ? "In review" : "Not reviewed";

  if (!editable && !reviewer && a.tier === "none" && !goldParent) return null;

  return (
    <div className="slab" style={{ gap: 14 }} id="enablement">
      <div className="row gap-2">
        <div className="section-title grow">Enablement review</div>
        <span className="tiny muted">{status}</span>
      </div>

      {a.tier !== "none" ? (
        <div className={styles.facts}>
          <span>Approved</span>
          <span>{day(a.approvedAt)}</span>
          {a.useCase ? (
            <>
              <span>Use case</span>
              <span>{a.useCase}</span>
            </>
          ) : null}
          {a.approvedBy ? (
            <>
              <span>Reviewer</span>
              <span>{a.approvedBy.name}</span>
            </>
          ) : null}
          {a.dueAt ? (
            <>
              <span>Next review</span>
              <span>{day(a.dueAt)}</span>
            </>
          ) : null}
        </div>
      ) : (
        <span className="small muted">
          {prompt.visibility !== "public"
            ? "Only public items can be reviewed."
            : open
              ? "Waiting for Enablement."
              : "Enablement hasn't reviewed this yet. Approved items rank higher in Discover, Claude and Slack."}
        </span>
      )}

      {approvedReview && a.tier !== "none" ? (
        <div className={styles.checks}>
          {RUBRIC.map((r) => (
            <span key={r.key} className={styles.checkLine}>
              {approvedReview.rubric[r.key] ? <CheckCircle weight="bold" size={14} className={styles.ok} /> : <Circle size={14} className={styles.miss} />}
              {r.label}
            </span>
          ))}
          {approvedReview.decisionNote ? <span className={styles.quote}>“{approvedReview.decisionNote}”</span> : null}
        </div>
      ) : null}

      {goldParent ? (
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Built from</span>
          <Link href={`/prompts/${goldParent.id}`} className={styles.lineage}>
            <Medal weight="bold" size={15} style={{ color: "#a2740f" }} />
            <span className="grow truncate">{goldParent.title}</span>
            <span className="tiny muted">Gold standard</span>
          </Link>
        </div>
      ) : null}

      {history.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">History</span>
          <div className={styles.timeline}>
            {history.map((r) => (
              <div key={r.id} className={styles.tl}>
                <span className={styles.dot} data-s={r.tier === "gold" && r.status === "approved" ? "gold" : r.status} />
                <div>
                  <strong>{r.status === "approved" && r.tier === "gold" ? "Made the gold standard" : STATUS_LABELS[r.status as ReviewStatus]}</strong>
                  {r.status === "requested" ? (r.requestedBy ? ` · ${r.requestedBy.name}` : "") : r.reviewer ? ` · ${r.reviewer.name}` : ""}
                  <div className="tiny muted">
                    {ago(r.decidedAt ?? r.createdAt)}
                    {r.status === "requested" && r.reason === "re_review" ? " · changed since approval" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row gap-2 wrap">
        {canRequest ? (
          <RequestReviewButton
            promptId={prompt.id}
            title={prompt.title}
            useCases={useCases.filter((u) => !u.archived).map((u) => ({ id: u.id, name: u.name }))}
            defaultUseCase={a.useCaseId}
            checks={{ description: !!prompt.description.trim(), notes: !!prompt.notes.trim() }}
            again={a.tier !== "none"}
          />
        ) : null}
        {reviewer ? (
          <Link href={`/enablement?item=${prompt.id}`} className="btn btn-outline btn-sm on-slab">
            {open ? "Review it" : approvalRank(a) > 0 ? "Re-review or change" : "Review it now"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
