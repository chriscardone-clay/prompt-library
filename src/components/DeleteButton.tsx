"use client";

import { Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deletePrompt } from "@/app/actions";
import { useToast } from "./Toast";
import styles from "./DeleteButton.module.css";

interface Props {
  promptId: string;
  title: string;
  /** Where to go afterwards. */
  returnHref: string;
}

/** Owner-only delete with an inline "Delete for everyone?" confirm. */
export function DeleteButton({ promptId, title, returnHref }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();
  const wrap = useRef<HTMLDivElement>(null);

  // Escape or clicking elsewhere puts the trash button back.
  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirming(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [confirming]);

  const doDelete = () => {
    if (pending) return;
    start(async () => {
      const res = await deletePrompt(promptId);
      if (!res.ok) {
        show(res.error);
        setConfirming(false);
        return;
      }
      router.push(`${returnHref}${returnHref.includes("?") ? "&" : "?"}toast=deleted`);
    });
  };

  return (
    <div ref={wrap} className={styles.wrap}>
      {confirming ? (
        <div className={styles.confirm} role="alertdialog" aria-label={`Delete ${title}?`}>
          <span className={styles.question}>Delete for everyone?</span>
          <button type="button" className={styles.delete} onClick={doDelete} disabled={pending} autoFocus>
            {pending ? "Deleting…" : "Delete"}
          </button>
          <button type="button" className={styles.keep} onClick={() => setConfirming(false)} disabled={pending}>
            Keep
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.trash}
          onClick={() => setConfirming(true)}
          aria-label="Delete"
          title="Delete"
        >
          <Trash size={16} />
        </button>
      )}
    </div>
  );
}
