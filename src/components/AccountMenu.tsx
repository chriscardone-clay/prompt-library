"use client";

import { Desktop, Moon, SignOut, Sun } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { type ThemePref, useTheme } from "@/lib/theme";
import type { Profile } from "@/lib/types";
import { Avatar } from "./Avatar";
import styles from "./AccountMenu.module.css";

const THEMES: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Desktop },
];

export function AccountMenu({ user }: { user: Profile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useTheme();

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
          <div className={styles.sectionLabel} id="appearance-label">
            Appearance
          </div>
          <div className={styles.seg} role="group" aria-labelledby="appearance-label">
            {THEMES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className={styles.segBtn}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                <Icon size={14} weight={theme === value ? "fill" : "regular"} />
                {label}
              </button>
            ))}
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
