"use client";

import { Copy, DownloadSimple, FileText, Package, Cube } from "@phosphor-icons/react";
import { useState } from "react";
import { downloadSkillBinary } from "@/lib/supabase/storage";
import { formatBytes } from "@/lib/skills";
import { isBinaryFile, type SkillFile } from "@/lib/types";
import { downloadBlob, zipBlob, type ZipEntry } from "@/lib/zip";
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
  const [busy, setBusy] = useState<"file" | "skill" | null>(null);
  const { show } = useToast();
  if (!files.length) return null;
  const cur = files[Math.min(idx, files.length - 1)];
  const curBinary = isBinaryFile(cur);
  const baseName = (n: string) => n.split("/").pop() || n;

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

  const downloadFile = async () => {
    if (!curBinary) {
      downloadBlob(new Blob([cur.content], { type: "text/plain" }), baseName(cur.name));
      return;
    }
    setBusy("file");
    try {
      downloadBlob(await downloadSkillBinary(cur.path!), baseName(cur.name));
    } catch {
      show(`Couldn't download ${cur.name}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadSkill = async () => {
    setBusy("skill");
    try {
      const entries: ZipEntry[] = await Promise.all(
        files.map(async (f): Promise<ZipEntry> => ({
          name: `${slug}/${f.name}`,
          content: isBinaryFile(f)
            ? new Uint8Array(await (await downloadSkillBinary(f.path!)).arrayBuffer())
            : f.content,
        })),
      );
      downloadBlob(zipBlob(entries), `${slug}.skill`);
      show(`Downloaded ${slug}.skill`);
    } catch {
      show("Couldn't build the .skill file. Try again.");
    } finally {
      setBusy(null);
    }
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
            title={isBinaryFile(f) ? `${f.name} · ${formatBytes(f.size ?? 0)}` : f.name}
          >
            {isBinaryFile(f) ? <Cube size={14} /> : <FileText size={14} />}
            {f.name}
          </button>
        ))}
        <div className="grow" />
        {!curBinary ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
            <Copy weight="bold" size={13} />
            Copy file
          </button>
        ) : null}
        <button type="button" className="btn btn-outline btn-sm" onClick={downloadFile} disabled={busy !== null}>
          <DownloadSimple weight="bold" size={13} />
          {busy === "file" ? "Downloading…" : "Download file"}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={downloadSkill}
          disabled={busy !== null}
          title="Zipped skill folder, ready to upload or unzip"
        >
          <Package weight="bold" size={13} />
          {busy === "skill" ? "Packing…" : `Download ${slug}.skill`}
        </button>
      </div>
      {curBinary ? (
        <div className={styles.binaryView}>
          <Cube size={28} className="muted" />
          <div className="stack" style={{ gap: 4 }}>
            <div style={{ fontWeight: 500 }}>{baseName(cur.name)}</div>
            <div className="small muted">
              Binary file · {formatBytes(cur.size ?? 0)}
              {cur.type ? ` · ${cur.type}` : ""}. Download it, or grab the whole .skill.
            </div>
          </div>
        </div>
      ) : (
        <pre className={styles.fileView}>{cur.content}</pre>
      )}
    </div>
  );
}
