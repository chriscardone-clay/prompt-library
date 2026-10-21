"use client";

import { CheckCircle, ShieldCheck, Warning, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { requestReview, withdrawReview } from "@/app/enablement/actions";
import { useToast } from "./Toast";
import styles from "./Approval.module.css";

interface Props {
  promptId: string;
  title: string;
  useCases: { id: string; name: string }[];
  defaultUseCase: string | null;
  checks: { description: boolean; notes: boolean };
  /** Already approved once (re-review). */
  again: boolean;
}

/** Owner / editor: ask Enablement to review this item. */
export function RequestReviewButton({ promptId, title, useCases, defaultUseCase, checks, again }: Props) {
  const [open, setOpen] = useState(false);
  const [useCase, setUseCase] = useState(defaultUseCase ?? "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const send = () =>
    start(async () => {
      const r = await requestReview(promptId, useCase || null, note);
      if (!r.ok) return show(r.error);
      setOpen(false);
      show("Sent to Enablement");
      router.refresh();
    });

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        <ShieldCheck weight="bold" size={14} />
        {again ? "Request re-review" : "Request an Enablement review"}
      </button>
      {open ? (
        <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="rq-title">
            <div className={styles.sheetHead}>
              <div className="stack grow" style={{ gap: 4 }}>
                <h2 id="rq-title" className="display-sm">
                  Request an Enablement review
                </h2>
                <span className="small muted">{title}</span>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.sheetBody}>
              <label className="field">
                <span className={styles.label}>Use case</span>
                <select className="input" value={useCase} onChange={(e) => setUseCase(e.target.value)}>
                  <option value="">Not sure, Enablement will pick</option>
                  {useCases.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <span className={styles.hint}>The job it does, from Enablement&apos;s list.</span>
              </label>
              <label className="field">
                <span className={styles.label}>What should the reviewer know?</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What it's for, what you changed, how you tested it."
                  autoFocus
                />
              </label>
              <div className="stack" style={{ gap: 8 }}>
                <span className={styles.label}>Before you send it</span>
                <Check ok={checks.description} text="Has a description" />
                <Check ok={checks.notes} text="Has How to use notes" />
              </div>
              <span className={styles.hint}>
                You&apos;ll get a Slack DM when it&apos;s decided. Changing the content after it&apos;s approved sends it back for a re-review.
              </span>
            </div>
            <div className={styles.sheetFoot}>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={pending}>
                {pending ? "Sending…" : "Send for review"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={styles.pre}>
      {ok ? <CheckCircle weight="bold" size={16} className={styles.ok} /> : <Warning weight="bold" size={16} style={{ color: "var(--warn-fg)" }} />}
      <span>
        {text}
        {ok ? "" : " (reviewers will likely ask for it)"}
      </span>
    </span>
  );
}

export function WithdrawReviewButton({ promptId }: { promptId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await withdrawReview(promptId);
          if (!r.ok) return show(r.error);
          show("Request withdrawn");
          router.refresh();
        })
      }
    >
      Withdraw
    </button>
  );
}
