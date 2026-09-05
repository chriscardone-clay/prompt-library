"use client";

import { type Tone, toneStyle } from "@/lib/catalog";

interface Props {
  label: string;
  selected: boolean;
  onClick: () => void;
  tone?: Tone | null;
  size?: "md" | "lg";
}

/** Filter / option chip. Selected = filled ink, or the app's tint when `tone` is given. */
export function Chip({ label, selected, onClick, tone, size = "md" }: Props) {
  return (
    <button
      type="button"
      className={`chip${size === "lg" ? " chip-lg" : ""}${tone ? " tone" : ""}`}
      aria-pressed={selected}
      data-tone={tone ? "" : undefined}
      onClick={onClick}
      style={tone ? (toneStyle(tone) as React.CSSProperties) : undefined}
    >
      {label}
    </button>
  );
}
