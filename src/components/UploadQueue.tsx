"use client";

import { Check, Cube, FileText, Package, Warning } from "@phosphor-icons/react";
import { formatBytes } from "@/lib/skills";
import styles from "./UploadQueue.module.css";

export type QueueStatus = "queued" | "reading" | "uploading" | "done" | "failed";

export interface QueueItem {
  id: string;
  name: string;
  size: number;
  kind: "archive" | "text" | "binary";
  status: QueueStatus;
  /** 0..1 for uploads; reading/queued show an indeterminate spinner. */
  progress: number;
  error?: string;
}

const STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "Queued",
  reading: "Reading…",
  uploading: "Uploading",
  done: "Done",
  failed: "Failed",
};

/**
 * Live view of an upload: one row per file with its state, plus an overall
 * progress bar. Weighted by bytes so a 400 KB font and a 1 KB note don't
 * count the same.
 */
export function UploadQueue({ items }: { items: QueueItem[] }) {
  if (!items.length) return null;
  const weightOf = (i: QueueItem) => Math.max(i.size, 1024);
  const totalWeight = items.reduce((n, i) => n + weightOf(i), 0);
  const doneWeight = items.reduce(
    (n, i) => n + weightOf(i) * (i.status === "done" || i.status === "failed" ? 1 : i.status === "uploading" ? i.progress : 0),
    0,
  );
  const fraction = totalWeight ? doneWeight / totalWeight : 0;
  const finished = items.filter((i) => i.status === "done" || i.status === "failed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const active = finished < items.length;

  return (
    <div className={styles.panel} role="status" aria-live="polite">
      <div className={styles.head}>
        <div className={styles.title}>
          {active ? <span className={styles.spinner} aria-hidden="true" /> : failed ? <Warning weight="bold" size={16} /> : <Check weight="bold" size={16} />}
          {active
            ? `Adding files · ${finished} of ${items.length}`
            : failed
              ? `${items.length - failed} of ${items.length} added · ${failed} failed`
              : `Added ${items.length} file${items.length === 1 ? "" : "s"}`}
        </div>
        <div className="tiny muted">{Math.round(fraction * 100)}%</div>
      </div>
      <div className={styles.bar}>
        <div className={styles.fill} style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      <ul className={styles.list}>
        {items.map((i) => (
          <li key={i.id} className={styles.row} data-status={i.status}>
            <span className={styles.icon}>
              {i.kind === "archive" ? <Package size={15} /> : i.kind === "binary" ? <Cube size={15} /> : <FileText size={15} />}
            </span>
            <span className={`${styles.name} truncate`} title={i.name}>
              {i.name}
            </span>
            <span className={styles.size}>{i.size ? formatBytes(i.size) : ""}</span>
            <span className={styles.status}>
              {i.status === "uploading" ? (
                <>
                  <span className={styles.miniBar}>
                    <span className={styles.miniFill} style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </span>
                  {Math.round(i.progress * 100)}%
                </>
              ) : i.status === "done" ? (
                <>
                  <Check weight="bold" size={13} />
                  {STATUS_LABEL.done}
                </>
              ) : i.status === "failed" ? (
                <>
                  <Warning weight="bold" size={13} />
                  {i.error || STATUS_LABEL.failed}
                </>
              ) : i.status === "reading" ? (
                <>
                  <span className={styles.spinnerSm} aria-hidden="true" />
                  {STATUS_LABEL.reading}
                </>
              ) : (
                STATUS_LABEL.queued
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
