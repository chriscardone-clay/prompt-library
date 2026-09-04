"use client";

import { Copy, DownloadSimple, FileText, Package } from "@phosphor-icons/react";
import { useState } from "react";
import { downloadBlob, zipBlob } from "@/lib/zip";
import type { SkillFile } from "@/lib/types";
import { useToast } from "./Toast";
import styles from "./Skill.module.css";

interface Props {
  files: SkillFile[];
  /** Folder name inside the .skill archive, e.g. "clay-formulas". */
  slug: string;
}

/** File tabs with a read-only viewer, plus copy / download / download-as-.skill. */
export function SkillFiles({ files, slug }: Props) {
  const [idx, setIdx] = useState(0);
  const { show } = useToast();
  if (!files.length) return null;
  const cur = files[Math.min(idx, files.length - 1)];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cur.content);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = cur.content;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    show(`Copied ${cur.name}`);
  };

  const downloadFile = () => downloadBlob(new Blob([cur.content], { type: "text/plain" }), cur.name.split("/").pop() || cur.name);

  const downloadSkill = () => {
    downloadBlob(zipBlob(files.map((f) => ({ name: `${slug}/${f.name}`, content: f.content }))), `${slug}.skill`);
    show(`Downloaded ${slug}.skill`);
  };

  return (
    <div className="panel">
      <div className={styles.fileBar}>
        {files.map((f, i) => (
          <button
            key={f.name}
            type="button"
            className={styles.fileTab}
            aria-pressed={i === idx}
            onClick={() => setIdx(i)}
          >
            <FileText size={14} />
            {f.name}
          </button>
        ))}
        <div className="grow" />
        <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
          <Copy weight="bold" size={13} />
          Copy file
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={downloadFile}>
          <DownloadSimple weight="bold" size={13} />
          Download file
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={downloadSkill}
          title="Zipped skill folder, ready to upload or unzip"
        >
          <Package weight="bold" size={13} />
          Download {slug}.skill
        </button>
      </div>
      <pre className={styles.fileView}>{cur.content}</pre>
    </div>
  );
}
