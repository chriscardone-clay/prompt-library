import { redirect } from "next/navigation";

/** Convenience URL for linking straight to the workflows view. */
export default function WorkflowsPage() {
  redirect("/?kind=workflows");
}
