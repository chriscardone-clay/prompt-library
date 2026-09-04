"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Shown only when the app is embedded (see .embed-only). Opens the current
 * page as a top-level tab, which is also where Google sign-in has to happen.
 */
export function OpenInNewTab({ className }: { className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const href = qs ? `${pathname}?${qs}` : pathname;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={`embed-only ${className ?? ""}`}
      title="Open in a new tab"
      aria-label="Open in a new tab"
    >
      <ArrowSquareOut size={18} weight="bold" />
    </a>
  );
}
