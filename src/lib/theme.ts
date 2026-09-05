"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Appearance preference. "system" follows the OS. The resolved value lives on
 * <html data-theme="light|dark">; an inline script in layout.tsx sets it
 * before first paint from the same localStorage key, so there is no flash.
 */
export type ThemePref = "light" | "dark" | "system";
export const THEME_KEY = "theme";

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyPref(pref: ThemePref) {
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}

/** Current preference + setter. Also follows OS changes and other tabs. */
export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    setPref(readPref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (readPref() === "system") applyPref("system");
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const p = readPref();
      setPref(p);
      applyPref(p);
    };
    mq.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* private mode: the choice just won't persist */
    }
    setPref(p);
    applyPref(p);
  }, []);

  return [pref, set];
}
