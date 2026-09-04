import styles from "./PromptNotes.module.css";

/**
 * "How to use" guidance under a prompt. Plain text with light structure:
 * blank lines separate paragraphs, lines starting with "- " are bullets, and a
 * line ending in ":" that precedes bullets or a paragraph reads as a label.
 */
export function PromptNotes({ notes }: { notes: string }) {
  const text = notes.trim();
  if (!text) return null;

  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*[-•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className={styles.list}>
          {items.map((it, j) => (
            <li key={j}>{it}</li>
          ))}
        </ul>,
      );
      continue;
    }
    // A short line ending in ":" is a label, whether or not a blank line follows it.
    if (/:$/.test(line.trim()) && line.trim().length < 60) {
      blocks.push(
        <div key={key++} className={styles.label}>
          {line.trim().replace(/:$/, "")}
        </div>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-•]\s+/.test(lines[i]) &&
      !(/:$/.test(lines[i].trim()) && lines[i].trim().length < 60)
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className={styles.para}>
        {para.join("\n")}
      </p>,
    );
  }

  return (
    <div className="slab" style={{ gap: 10 }}>
      <div className="section-title">How to use</div>
      <div className={styles.body}>{blocks}</div>
    </div>
  );
}
