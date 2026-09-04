"use client";

import { ArrowFatUp } from "@phosphor-icons/react";
import { useEffect, useState, useTransition } from "react";
import { toggleUpvote } from "@/app/actions";
import { useToast } from "./Toast";
import styles from "./VoteButton.module.css";

interface Props {
  promptId: string;
  count: number;
  voted: boolean;
  size?: "sm" | "md";
  /** On cards the button sits on an Oat-200 slab; on the detail page on the cream page. */
  surface?: "slab" | "page";
}

export function VoteButton({ promptId, count, voted, size = "sm", surface = "slab" }: Props) {
  const [state, setState] = useState({ count, voted });
  const [pending, start] = useTransition();
  const { show } = useToast();

  // Keep in sync when the server re-renders with fresh data.
  useEffect(() => setState({ count, voted }), [count, voted]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !state.voted;
    setState((s) => ({ voted: next, count: s.count + (next ? 1 : -1) }));
    start(async () => {
      const res = await toggleUpvote(promptId, next);
      if (!res.ok) {
        setState({ count, voted });
        show(res.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={state.voted}
      aria-label={state.voted ? "Remove upvote" : "Upvote"}
      className={`${styles.btn} ${size === "md" ? styles.md : ""} ${
        surface === "page" ? styles.onPage : ""
      }`}
      data-voted={state.voted ? "" : undefined}
    >
      <ArrowFatUp weight={state.voted ? "fill" : "bold"} size={size === "md" ? 15 : 13} />
      {state.count}
    </button>
  );
}
