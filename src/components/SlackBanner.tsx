"use client";

import { SlackLogo, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { SLACK_CHANNEL_NAME, SLACK_CHANNEL_URL } from "@/lib/constants";
import styles from "./SlackBanner.module.css";

const KEY = "slack-banner-dismissed";

/**
 * Invitation to join #auto-clayprompts, shown to signed-in people who aren't
 * in the channel yet (decided on the server). Dismissing hides it for the
 * rest of the browser session.
 */
export function SlackBanner() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      setVisible(sessionStorage.getItem(KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);
  const dismiss = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* fine */
    }
    setVisible(false);
  };
  if (!visible) return null;
  return (
    <div role="status" className={`${styles.banner} embed-hide`}>
      <SlackLogo weight="fill" size={22} className={styles.icon} />
      <div className={styles.text}>
        <span className={styles.title}>Get the week's most upvoted prompts in Slack.</span>
        <span className={styles.sub}>{SLACK_CHANNEL_NAME} posts the top prompts, skills and new additions every Monday.</span>
      </div>
      <div className={styles.actions}>
        <a href={SLACK_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className={styles.join} onClick={dismiss}>
          <SlackLogo weight="bold" size={15} />
          Join the channel
        </a>
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismiss}>
          <X weight="bold" size={15} />
        </button>
      </div>
    </div>
  );
}
