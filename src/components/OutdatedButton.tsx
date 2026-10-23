"use client";

import { Warning, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { setOutdated } from "@/app/enablement/actions";
import { useToast } from "./Toast";
import styles from "./Approval.module.css";

/** Reviewers: flag an item as outdated (with what's out of date), or clear the flag. */
export function OutdatedButton({ promptId, title, outdated, gold }: { promptId: string; title: string; outdated: boolean; gold: boolean }) {
  const [open, setOpen] = useState(false);
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
      const r = await setOutdated(promptId, !outdated, note);
      if (!r.ok) return show(r.error);
      setOpen(false);
      setNote("");
      show(outdated ? "Outdated flag cleared" : "Flagged as outdated");
      router.refresh();
    });

  return (
    <>
      <button type="button" className="btn btn-outline btn-sm on-slab" onClick={() => setOpen(true)}>
        <Warning weight="bold" size={14} />
        {outdated ? "Clear outdated flag" : "Flag as outdated"}
      </button>
      {open ? (
        <div className={styles.scrim} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="od-title">
            <div className={styles.sheetHead}>
              <div className="stack grow" style={{ gap: 4 }}>
                <h2 id="od-title" className="display-sm">
                  {outdated ? "Clear the outdated flag" : "Flag as outdated"}
                </h2>
                <span className="small muted">{title}</span>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className={styles.sheetBody}>
              <label className="field">
                <span className={styles.label}>{outdated ? "Note (optional)" : "What's out of date?"}</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={outdated ? "Why it's current again." : "e.g. Uses the old credit pricing; Claygent now has a built-in step for this."}
                  autoFocus
                />
              </label>
              <span className={styles.hint}>
                {outdated
                  ? "It ranks normally again. Approving the item also clears the flag."
                  : `Everyone sees a warning on its page, and it's listed after current items in Discover, Claude and Slack. The owner gets a Slack DM.${gold ? " It stops being the gold standard for its use case." : ""}`}
              </span>
            </div>
            <div className={styles.sheetFoot}>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={send} disabled={pending || (!outdated && !note.trim())}>
                {pending ? "Saving…" : outdated ? "Clear flag" : "Flag as outdated"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
