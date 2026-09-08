import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { linkHost } from "@/lib/skills";
import type { SkillLink } from "@/lib/types";
import styles from "./Skill.module.css";

/** Link cards to where the item lives (skills) or is saved (prompts: a Granola recipe, a Claude project). */
export function SkillLinks({ links, kind = "skill" }: { links: SkillLink[]; kind?: "prompt" | "skill" }) {
  if (!links.length) return null;
  return (
    <div className="slab">
      <div className="stack" style={{ gap: 4 }}>
        <div className="section-title">{kind === "skill" ? "Open it where it lives" : "Open it where it's saved"}</div>
        <div className="small muted">
          {kind === "skill"
            ? "This skill is set up in its home app. Open the link to use it there."
            : "This prompt is saved in its home app (a recipe, a project, a custom GPT). Open it there instead of pasting it each time."}
        </div>
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
