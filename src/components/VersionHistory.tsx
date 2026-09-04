"use client";

import {
  ArrowCounterClockwise,
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { restoreVersion } from "@/app/actions";
import { ago } from "@/lib/format";
import type { PromptVersion } from "@/lib/types";
import { useToast } from "./Toast";
import styles from "./VersionHistory.module.css";

interface Props {
  versions: PromptVersion[]; // oldest → newest
  currentLabel: string;
  currentSub: string;
}

export function VersionHistory({ versions, currentLabel, currentSub }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();

  const restore = (v: PromptVersion, n: number) => {
    if (pending) return;
    start(async () => {
      const res = await restoreVersion(v.id);
      if (!res.ok) {
        show(res.error);
        return;
      }
      setOpen(null);
      show(`Restored version ${n}`);
      router.refresh();
    });
  };

  const newestFirst = versions.map((v, i) => ({ v, n: i + 1 })).reverse();

  return (
    <div className="slab">
      <div className={styles.head}>
        <div className={styles.title}>
          <ClockCounterClockwise size={18} className="muted" />
          <div className="section-title">Version history</div>
        </div>
        <div className="tiny muted">Only you and your editors can see this.</div>
      </div>
      <div className={styles.list}>
        <div className={styles.current}>
          <span className={styles.label}>{currentLabel}</span>
          <span className={styles.sub}>{currentSub}</span>
        </div>
        {newestFirst.map(({ v, n }) => {
          const isOpen = open === v.id;
          return (
            <div key={v.id} className={styles.item}>
              <button
                type="button"
                className={styles.toggle}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : v.id)}
              >
                <div className={styles.toggleText}>
                  <span className={styles.label}>Version {n}</span>
                  <span className={`${styles.sub} truncate`}>
                    {v.savedBy?.name ?? "Unknown"} · {ago(v.savedAt)}
                  </span>
                </div>
                {isOpen ? (
                  <CaretUp weight="bold" size={13} className="muted" />
                ) : (
                  <CaretDown weight="bold" size={13} className="muted" />
                )}
              </button>
              {isOpen ? (
                <div className={styles.detail}>
                  <div className={styles.vTitle}>{v.title}</div>
                  <div className={styles.vBody}>{v.body}</div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ alignSelf: "flex-start" }}
                    disabled={pending}
                    onClick={() => restore(v, n)}
                  >
                    <ArrowCounterClockwise weight="bold" size={13} />
                    Restore this version
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {versions.length === 0 ? (
          <div className={styles.none}>No earlier versions yet. Every saved edit is kept here.</div>
        ) : null}
      </div>
    </div>
  );
}
