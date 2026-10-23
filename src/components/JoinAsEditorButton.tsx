"use client";

import { PencilSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { joinAsEditor } from "@/app/enablement/actions";
import { useToast } from "./Toast";

/** Reviewers: add yourself as an editor of a public item to fix it yourself. */
export function JoinAsEditorButton({ promptId }: { promptId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { show } = useToast();
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm on-slab"
      disabled={pending}
      data-tip="Become an editor so you can update it. The owner gets a Slack DM."
      onClick={() =>
        start(async () => {
          const r = await joinAsEditor(promptId);
          if (!r.ok) return show(r.error);
          show("You're an editor now");
          router.push(`/prompts/${promptId}/edit`);
        })
      }
    >
      <PencilSimple weight="bold" size={14} />
      {pending ? "Adding you…" : "Edit as Enablement"}
    </button>
  );
}
