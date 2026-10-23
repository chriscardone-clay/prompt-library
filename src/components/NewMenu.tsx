"use client";

import { CaretDown, ChatText, Files, FlowArrow, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./NewMenu.module.css";

/** One "New" button for every kind of item, so the header has room. */
export function NewMenu({ workflows }: { workflows: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: "/prompts/new", Icon: ChatText, label: "Prompt", hint: "Paste into Claude, ChatGPT or Town" },
    { href: "/skills/new", Icon: Files, label: "Skill", hint: "A SKILL.md bundle you install" },
    ...(workflows ? [{ href: "/workflows/new", Icon: FlowArrow, label: "Workflow", hint: "A Clay Workflows architecture" }] : []),
  ];

  return (
    <div className={styles.wrap} ref={ref}>
      <button type="button" className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus weight="bold" size={14} />
        New
        <CaretDown weight="bold" size={12} className={styles.caret} />
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          {items.map(({ href, Icon, label, hint }) => (
            <Link key={href} href={href} className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
              <span className={styles.icon}>
                <Icon size={16} weight="bold" />
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{label}</span>
                <span className={styles.hint}>{hint}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
