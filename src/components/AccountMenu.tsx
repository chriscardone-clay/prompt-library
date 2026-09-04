"use client";

import { SignOut } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import type { Profile } from "@/lib/types";
import { Avatar } from "./Avatar";
import styles from "./AccountMenu.module.css";

export function AccountMenu({ user }: { user: Profile }) {
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
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const person = { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatar_url };

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar person={person} size={36} />
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <div className={styles.who}>
            <div className={styles.name}>{user.name}</div>
            <div className={styles.email}>{user.email}</div>
          </div>
          <div className={styles.divider} />
          <form action={signOut}>
            <button type="submit" className={styles.item} role="menuitem">
              <SignOut size={16} className="muted" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
