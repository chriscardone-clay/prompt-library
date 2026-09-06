"use client";

import type { SlackBlock } from "@/lib/digest/types";
import styles from "./SlackPreview.module.css";

/** Slack mrkdwn → HTML, close enough for an admin preview. */
export function mrkdwnToHtml(text: string): string {
  const escaped = text.replace(/&(?!amp;|lt;|gt;)/g, "&amp;");
  return escaped
    .replace(/<((?:https?:)[^|>]+)\|([^>]+)>/g, (_m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/<((?:https?:)[^>]+)>/g, (_m, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?])/g, "$1<i>$2</i>")
    .replace(/\n/g, "<br />");
}

function textOf(b: SlackBlock): string {
  const t = b.text as { text?: string } | undefined;
  return t?.text ?? "";
}

/** Renders a Block Kit message the way Slack roughly would. */
export function SlackPreview({ blocks, author = "Clay Prompt Library", intro }: { blocks: SlackBlock[]; author?: string; intro?: React.ReactNode }) {
  return (
    <div className={styles.slack} aria-label="Preview of the Slack message">
      {intro}
      <div className={styles.who}>
        <span className={styles.avatar} aria-hidden="true" />
        <b>{author}</b>
        <span className={styles.app}>App</span>
      </div>
      <div className={styles.body}>
        {blocks.map((b, i) => {
          switch (b.type) {
            case "header":
              return (
                <div key={i} className={styles.header}>
                  {textOf(b)}
                </div>
              );
            case "context": {
              const els = (b.elements as { text: string }[]) ?? [];
              return <div key={i} className={styles.context} dangerouslySetInnerHTML={{ __html: els.map((e) => mrkdwnToHtml(e.text)).join(" ") }} />;
            }
            case "divider":
              return <hr key={i} className={styles.divider} />;
            case "section": {
              const acc = b.accessory as { text?: { text: string }; url?: string } | undefined;
              return (
                <div key={i} className={styles.section}>
                  <div dangerouslySetInnerHTML={{ __html: mrkdwnToHtml(textOf(b)) }} />
                  {acc?.url ? (
                    <a className={styles.btn} href={acc.url} target="_blank" rel="noopener noreferrer">
                      {acc.text?.text ?? "Open"}
                    </a>
                  ) : null}
                </div>
              );
            }
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
