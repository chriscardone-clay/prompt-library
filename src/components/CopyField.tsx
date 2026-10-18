"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { useState } from "react";
import styles from "./CopyField.module.css";

/** A read-only value (a URL, a command) with a copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={styles.field}>
      <code className={styles.value} aria-label={label}>
        {value}
      </code>
      <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
