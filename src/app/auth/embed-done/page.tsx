"use client";

import { useEffect, useState } from "react";

export const EMBED_MESSAGE_TYPE = "clay-prompt-library:oauth-code";

/**
 * Where Google sends the popup opened from an embedded sign-in. Hands the
 * one-time code back to the iframe that opened us (same origin only) and
 * closes. Rendered as a page, never inside the frame.
 */
export default function EmbedDonePage() {
  const [state, setState] = useState<"working" | "handed" | "no-opener" | "error">("working");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const err = params.get("error_description") || params.get("error");
    const opener = window.opener as Window | null;

    if (err || !code) {
      setDetail(err || "No sign-in code was returned.");
      setState("error");
      return;
    }
    if (!opener || opener.closed) {
      setState("no-opener");
      return;
    }
    try {
      opener.postMessage({ type: EMBED_MESSAGE_TYPE, code }, window.location.origin);
      setState("handed");
      // Give the message a moment to land, then get out of the way.
      setTimeout(() => window.close(), 400);
    } catch {
      setState("no-opener");
    }
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="slab-lg"
        style={{
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
          maxWidth: 440,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/Clay_Logo_3D_Blk.png" alt="Clay" style={{ height: 24, width: "auto" }} />
        {state === "working" || state === "handed" ? (
          <>
            <div className="display-sm">Signed in</div>
            <div className="muted small">Finishing up in the embed. This window closes itself.</div>
          </>
        ) : state === "no-opener" ? (
          <>
            <div className="display-sm">Almost there</div>
            <div className="muted small">
              This window lost track of the embed that opened it. Close it and click sign in again
              inside the embed.
            </div>
          </>
        ) : (
          <>
            <div className="display-sm">Sign-in didn&apos;t complete</div>
            <div className="muted small">{detail}</div>
          </>
        )}
      </div>
    </main>
  );
}
