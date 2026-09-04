import { APP_COLORS, INSTALL } from "@/lib/constants";
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
export function SkillInstall({ apps }: { apps: PromptApp[] }) {
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const a of apps) {
    const keys = a.surfaces.length ? a.surfaces.map((s) => `${a.app} · ${s}`) : [a.app];
    for (const k of keys) {
      const text = INSTALL[k] ?? INSTALL[a.app];
      if (!text || seen.has(text)) continue;
      seen.add(text);
      rows.push({ key: k, label: k, text, bg: APP_COLORS[a.app].bg, fg: APP_COLORS[a.app].fg });
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
