"use client";

interface Props {
  label: string;
  selected: boolean;
  onClick: () => void;
  tone?: { bg: string; fg: string } | null;
  size?: "md" | "lg";
}

/** Filter / option chip. Selected = filled ink, or the app's tint when `tone` is given. */
export function Chip({ label, selected, onClick, tone, size = "md" }: Props) {
  return (
    <button
      type="button"
      className={`chip${size === "lg" ? " chip-lg" : ""}`}
      aria-pressed={selected}
      data-tone={tone ? "" : undefined}
      onClick={onClick}
      style={
        tone
          ? ({ "--chip-bg": tone.bg, "--chip-fg": tone.fg } as React.CSSProperties)
          : undefined
      }
    >
      {label}
    </button>
  );
}
