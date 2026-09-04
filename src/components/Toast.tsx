"use client";

import { Check } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./Toast.module.css";

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 1800);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {message ? (
        <div className={styles.toast} role="status" aria-live="polite">
          <Check weight="bold" size={16} />
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

const QUERY_TOASTS: Record<string, string> = {
  published: "Prompt published",
  "published-skill": "Skill published",
  saved: "Changes saved",
  forked: "Fork created",
  restored: "Version restored",
  deleted: "Prompt deleted",
};

/**
 * Server actions redirect with `?toast=published` etc. This reads the flag,
 * shows the toast, and strips it from the URL.
 */
export function ToastFromQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { show } = useToast();
  const key = params.get("toast");

  useEffect(() => {
    if (!key) return;
    const msg = QUERY_TOASTS[key];
    if (msg) show(msg);
    const next = new URLSearchParams(params.toString());
    next.delete("toast");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [key, params, pathname, router, show]);

  return null;
}
