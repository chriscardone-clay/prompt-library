"use client";

import { Copy, DownloadSimple, FileText } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { formatBytes } from "@/lib/skills";
import { useToast } from "./Toast";
import styles from "./WorkflowDoc.module.css";

interface Props {
  name: string;
  bytes: number;
  /** The raw .md, for Source view and Copy. */
  source: string;
  downloadHref: string;
  /** The server-rendered document (MarkdownDoc). */
  children: ReactNode;
}

/** A workflow's .md with a Rendered / Source toggle, Copy Markdown and Download. */
export function WorkflowDoc({ name, bytes, source, downloadHref, children }: Props) {
  const [view, setView] = useState<"rendered" | "source">("rendered");
  const { show } = useToast();

  // A "#L212" link (from the customer-ready check) opens Source at that line.
  useEffect(() => {
    const onHash = () => {
      const m = /^#L(\d+)$/.exec(window.location.hash);
      if (!m) return;
      setView("source");
      requestAnimationFrame(() => document.getElementById(`L${m[1]}`)?.scrollIntoView({ block: "center" }));
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = source;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    show("Copied the Markdown");
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <span className={styles.file}>
          <FileText size={15} />
          <span className="truncate">{name}</span>
          <span className={styles.size}>· {formatBytes(bytes)}</span>
        </span>
        <div className={styles.seg} role="group" aria-label="View">
          <button type="button" aria-pressed={view === "rendered"} onClick={() => setView("rendered")}>
            Rendered
          </button>
          <button type="button" aria-pressed={view === "source"} onClick={() => setView("source")}>
            Source
          </button>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-outline btn-sm on-slab" onClick={copy}>
            <Copy size={14} />
            Copy Markdown
          </button>
          <a href={downloadHref} className="btn btn-primary btn-sm" download={name}>
            <DownloadSimple weight="bold" size={14} />
            Download .md
          </a>
        </div>
      </div>
      {view === "rendered" ? (
        <div className={styles.rendered}>{children}</div>
      ) : (
        <div className={styles.source} role="region" aria-label="Markdown source">
          <ol className={styles.lines}>
            {source.split(/\r\n|\r|\n/).map((line, i) => (
              <li key={i} id={`L${i + 1}`}>
                <code>{line || " "}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
