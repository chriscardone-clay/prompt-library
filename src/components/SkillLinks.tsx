import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { linkHost } from "@/lib/skills";
import type { SkillLink } from "@/lib/types";
import styles from "./Skill.module.css";

/** "Open it where it lives": link cards to the skill's home app. */
export function SkillLinks({ links }: { links: SkillLink[] }) {
  if (!links.length) return null;
  return (
    <div className="slab">
      <div className="stack" style={{ gap: 4 }}>
        <div className="section-title">Open it where it lives</div>
        <div className="small muted">This skill is set up in its home app. Open the link to use it there.</div>
      </div>
      <div className={styles.linkGrid}>
        {links.map((l, i) => (
          <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className={styles.linkCard}>
            <div className={styles.linkIcon}>
              <ArrowSquareOut size={18} />
            </div>
            <div className={styles.linkText}>
              <span className={`${styles.linkLabel} truncate`}>{l.label || linkHost(l.url)}</span>
              <span className={`${styles.linkHost} truncate`}>{linkHost(l.url)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
