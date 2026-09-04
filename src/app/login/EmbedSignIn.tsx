"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";

/**
 * Sign-in controls for when the app is embedded in an iframe. Google refuses
 * to run OAuth inside a frame, so the sign-in opens in a new tab; once it
 * finishes, the embed reloads and picks up the session cookie.
 */
export function EmbedSignIn({ next, googleMark }: { next: string; googleMark: React.ReactNode }) {
  const [opened, setOpened] = useState(false);
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <>
      <a
        href={`/login?next=${encodeURIComponent(safeNext)}`}
        target="_blank"
        rel="noopener"
        className="btn btn-primary btn-xl"
        onClick={() => setOpened(true)}
      >
        {googleMark}
        Sign in with Google in a new tab
      </a>
      {opened ? (
        <button
          type="button"
          className="btn btn-outline btn-lg"
          onClick={() => window.location.reload()}
        >
          <ArrowClockwise weight="bold" size={15} />
          I&apos;ve signed in, reload
        </button>
      ) : null}
      <div style={{ fontSize: 12, color: "var(--fg-muted)", letterSpacing: "0.03em" }}>
        Sign in with your @{ALLOWED_EMAIL_DOMAIN} account. If this embed still shows the sign-in
        screen afterwards, your browser is blocking third-party cookies; open the library in a new
        tab instead.
      </div>
    </>
  );
}
