"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { beginEmbedSignIn } from "@/app/actions";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";

const MESSAGE_TYPE = "clay-prompt-library:oauth-code";

type Phase = "idle" | "opening" | "waiting" | "finishing" | "error";

/**
 * Sign-in for when the app is embedded in an iframe (a Notion page).
 *
 * Google refuses to run OAuth inside a frame, so:
 *  1. we start the flow from the iframe (that stores the PKCE verifier in the
 *     embed's own cookie partition),
 *  2. open Google in a popup,
 *  3. the popup lands on /auth/embed-done and posts the one-time code back here,
 *  4. we exchange it via /auth/embed-callback, which sets the session cookies
 *     in this partition, and reload.
 */
export function EmbedSignIn({ googleMark }: { googleMark: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; code?: string } | null;
      if (!data || data.type !== MESSAGE_TYPE || typeof data.code !== "string") return;
      setPhase("finishing");
      try {
        const res = await fetch("/auth/embed-callback", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: data.code }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(
            body.error === "domain"
              ? `That account isn't on ${ALLOWED_EMAIL_DOMAIN}. Use your work Google account.`
              : "Sign-in didn't complete. Try again.",
          );
          setPhase("error");
          return;
        }
        window.location.reload();
      } catch {
        setError("Sign-in didn't complete. Try again.");
        setPhase("error");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const start = async () => {
    setError(null);
    setFallbackUrl(null);
    setPhase("opening");
    // Open synchronously inside the click so popup blockers allow it.
    popup.current = window.open("about:blank", "clay-prompt-library-signin", "popup,width=520,height=720");
    const res = await beginEmbedSignIn();
    if (!res.ok) {
      popup.current?.close();
      setError(res.error);
      setPhase("error");
      return;
    }
    if (popup.current && !popup.current.closed) {
      popup.current.location.href = res.data.url;
      setPhase("waiting");
    } else {
      // Popup blocked (some sandboxes): offer a plain link instead.
      setFallbackUrl(res.data.url);
      setPhase("waiting");
    }
  };

  const busy = phase === "opening" || phase === "finishing";

  return (
    <>
      <button type="button" className="btn btn-primary btn-xl" onClick={start} disabled={busy}>
        {googleMark}
        {phase === "finishing" ? "Finishing sign-in…" : "Continue with Google"}
      </button>
      {fallbackUrl ? (
        <a href={fallbackUrl} target="_blank" rel="opener" className="btn btn-outline btn-lg">
          <ArrowSquareOut weight="bold" size={15} />
          Open Google sign-in
        </a>
      ) : null}
      {phase === "waiting" && !fallbackUrl ? (
        <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
          Finish signing in with Google in the window that just opened. This embed will update by
          itself.
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: "var(--pom-400)",
            background: "var(--pom-100)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {error}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--fg-muted)", letterSpacing: "0.03em" }}>
          Sign in with your @{ALLOWED_EMAIL_DOMAIN} account. Sign-in opens in a small window.
        </div>
      )}
    </>
  );
}
