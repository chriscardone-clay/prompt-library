"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const missingEnv = /NEXT_PUBLIC_SUPABASE/.test(error.message);

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
          padding: 48,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
          maxWidth: 520,
        }}
      >
        <div className="display-sm">Something went wrong</div>
        <div className="muted small" style={{ maxWidth: "44ch" }}>
          {missingEnv
            ? "The app isn't connected to Supabase yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to the environment and redeploy."
            : "Try again. If it keeps happening, tell GTM Ops."}
        </div>
        {error.digest ? (
          <div className="eyebrow">ref {error.digest}</div>
        ) : null}
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
