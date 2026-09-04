import { redirect } from "next/navigation";

/** Convenience URL for embedding or linking straight to the skills view. */
export default function SkillsPage() {
  redirect("/?kind=skills");
}
