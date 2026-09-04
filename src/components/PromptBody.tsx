"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fillBody, parsePlaceholders, segmentBody, wordCount } from "@/lib/placeholders";
import { useToast } from "./Toast";
import styles from "./PromptBody.module.css";

interface Props {
  promptId: string;
  body: string;
}

const storageKey = (id: string) => `clay-prompt-fills:${id}`;

/** "Fill in the blanks" form + live preview + copy. Fills persist per prompt in this browser. */
export function PromptBody({ promptId, body }: Props) {
  const keys = useMemo(() => parsePlaceholders(body), [body]);
  const [fills, setFills] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { show } = useToast();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(promptId));
      if (raw) setFills(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [promptId]);

  const update = (k: string, v: string) => {
    setFills((f) => {
      const next = { ...f, [k]: v };
      try {
        localStorage.setItem(storageKey(promptId), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const copy = async () => {
    const text = fillBody(body, fills);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    show("Copied to clipboard");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  const filled = keys.filter((k) => fills[k]?.trim()).length;
  const segments = segmentBody(body, fills);

  return (
    <>
      {keys.length ? (
        <div className="slab">
          <div className={styles.fillHead}>
            <div className="section-title">Fill in the blanks</div>
            <div className="tiny muted">
              {filled} of {keys.length} filled
            </div>
          </div>
          <div className={styles.fillGrid}>
            {keys.map((k) => (
              <label key={k} className="field">
                <span className="eyebrow">{k}</span>
                <input
                  className="input"
                  value={fills[k] ?? ""}
                  onChange={(e) => update(k, e.target.value)}
                  placeholder={`Enter ${k.replace(/_/g, " ")}`}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className={styles.panelHead}>
          <div className="eyebrow">Prompt · {wordCount(body)} words</div>
          <button type="button" className="btn btn-primary btn-md" onClick={copy}>
            {copied ? <Check weight="bold" size={15} /> : <Copy weight="bold" size={15} />}
            {copied ? "Copied" : "Copy prompt"}
          </button>
        </div>
        <div className={styles.body}>
          {segments.map((s, i) =>
            s.kind === "text" ? (
              <span key={i} className={styles.text}>
                {s.text}
              </span>
            ) : (
              <span
                key={i}
                className={`${styles.ph} ${s.value.trim() ? styles.phFilled : ""}`}
                title={s.value.trim() ? s.key : undefined}
              >
                {s.value.trim() ? s.value : s.key}
              </span>
            ),
          )}
        </div>
      </div>
    </>
  );
}
