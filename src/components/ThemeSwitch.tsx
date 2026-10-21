"use client";

import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { type ThemePref, useTheme } from "@/lib/theme";
import styles from "./ThemeSwitch.module.css";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Desktop },
];

/** Light / Dark / System in the footer: always findable, never in the header's way. Same setting as the account menu. */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className={styles.seg} role="group" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" className={styles.btn} aria-pressed={theme === value} onClick={() => setTheme(value)}>
          <Icon size={14} weight={theme === value ? "fill" : "regular"} />
          {label}
        </button>
      ))}
    </div>
  );
}
