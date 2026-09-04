import { appTone, installFor, type Catalog } from "@/lib/catalog";
import type { PromptApp } from "@/lib/types";
import styles from "./Skill.module.css";

interface Row {
  key: string;
  label: string;
  text: string;
  bg: string;
  fg: string;
}

/** Per-app install instructions for a skill's files, one line per distinct instruction. */
export function SkillInstall({ apps, catalog }: { apps: PromptApp[]; catalog: Catalog }) {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const a of apps) {
    const tone = appTone(catalog, a.app);
    const entries = a.surfaces.length ? a.surfaces.map((s) => ({ key: `${a.app} · ${s}`, s })) : [{ key: a.app, s: undefined }];
    for (const e of entries) {
      const text = installFor(catalog, a.app, e.s);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      rows.push({ key: e.key, label: e.key, text, bg: tone.bg, fg: tone.fg });
    }
  }
  if (!rows.length) return null;
  return (
    <div className="slab" style={{ gap: 12 }}>
      <div className="section-title">Install</div>
      <div className={styles.installList}>
        {rows.map((r) => (
          <div key={r.key} className={styles.installRow}>
            <span className="tag" style={{ background: r.bg, color: r.fg, marginTop: 2, flex: "none" }}>
              {r.label}
            </span>
            <span className={styles.installText}>{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
