"use client";

import { Heart } from "@phosphor-icons/react";
import { useEffect, useState, useTransition } from "react";
import { toggleFavorite } from "@/app/actions";
import { useToast } from "./Toast";
import styles from "./FavoriteButton.module.css";

interface Props {
  promptId: string;
  favorited: boolean;
  /** "icon" on cards; "pill" (with a label) on the detail page. */
  variant?: "icon" | "pill";
}

export function FavoriteButton({ promptId, favorited, variant = "icon" }: Props) {
  const [on, setOn] = useState(favorited);
  const [pending, start] = useTransition();
  const { show } = useToast();
  useEffect(() => setOn(favorited), [favorited]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !on;
    setOn(next);
    start(async () => {
      const res = await toggleFavorite(promptId, next);
      if (!res.ok) {
        setOn(!next);
        show(res.error);
      } else show(next ? "Saved to favorites" : "Removed from favorites");
    });
  };

  const label = on ? "Saved" : "Save";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Save to favorites"}
      title={on ? "Remove from favorites" : "Save to favorites"}
      className={variant === "pill" ? styles.pill : styles.icon}
      data-on={on ? "" : undefined}
    >
      <Heart weight={on ? "fill" : "regular"} size={variant === "pill" ? 15 : 18} />
      {variant === "pill" ? label : null}
    </button>
  );
}
