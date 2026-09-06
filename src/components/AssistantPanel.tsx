"use client";

import { PaperPlaneRight } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { askAssistant, type AskResult } from "@/app/admin/actions";
import { SlackPreview } from "./SlackPreview";
import styles from "./AssistantPanel.module.css";

interface Props {
  eventsReady: boolean;
  slackReady: boolean;
  model: string;
  recent: { id: string; created_at: string; source: string; question: string; matched: number; fallback: boolean; error: string | null }[];
}

const EXAMPLES = [
  "I need a prompt to recap a customer call for Slack",
  "Is there a skill for writing Clay formulas?",
  "Something to research an account before a first meeting",
];

export function AssistantPanel({ eventsReady, slackReady, model, recent }: Props) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    setQ(text);
    setError(null);
    start(async () => {
      const res = await askAssistant(text);
      if (res.ok) setResult(res.data);
      else {
        setResult(null);
        setError(res.error);
      }
    });
  };

  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h2 className="section-title">Slack assistant</h2>
        <span className="tiny muted">People @mention or DM the bot; it answers with matching prompts and skills, or nudges them to add one.</span>
      </div>

      <div className={styles.status}>
        <span className={`${styles.dot} ${eventsReady ? styles.on : styles.off}`} />
        <span>{eventsReady ? "Events endpoint is armed" : "Events endpoint is off: set SLACK_SIGNING_SECRET"} </span>
        <span className={`${styles.dot} ${slackReady ? styles.on : styles.off}`} />
        <span>{slackReady ? "Can reply in Slack" : "Can't reply: set SLACK_BOT_TOKEN"}</span>
        <span className={`tiny muted ${styles.model}`}>Model: {model}</span>
      </div>

      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask it like a teammate would…" maxLength={500} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !q.trim()}>
          <PaperPlaneRight weight="fill" size={13} />
          {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className={styles.examples}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" disabled={pending} onClick={() => ask(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {error ? <div className={styles.warn}>{error}</div> : null}
      {result ? (
        <div className={styles.result}>
          <div className={`tiny muted ${styles.meta}`}>
            {result.candidates} items considered{result.shortlisted ? " (shortlisted by search)" : ""} · {result.matches} match{result.matches === 1 ? "" : "es"} ·{" "}
            {result.fallback ? <b>keyword fallback (model unavailable{result.error ? `: ${result.error.slice(0, 120)}` : ""})</b> : `answered by ${result.model}`}
          </div>
          <SlackPreview blocks={result.blocks} />
        </div>
      ) : null}

      <div className={styles.recent}>
        <span className="eyebrow">Recent questions</span>
        {recent.length ? (
          <div className={styles.recentList}>
            {recent.map((r) => (
              <div key={r.id} className={styles.recentRow}>
                <span className={styles.src}>{r.source === "mention" ? "@mention" : r.source === "dm" ? "DM" : "test"}</span>
                <span className={styles.q}>{r.question}</span>
                <span className="tiny muted">
                  {r.matched} match{r.matched === 1 ? "" : "es"}
                  {r.fallback ? " · keyword fallback" : ""}
                  {r.error ? " · error" : ""}
                </span>
                <span className="tiny muted">{new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="tiny muted">No questions yet.</span>
        )}
      </div>
    </div>
  );
}
