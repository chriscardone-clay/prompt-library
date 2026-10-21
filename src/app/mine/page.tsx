import { redirect } from "next/navigation";

/** The old Created page: now Discover's Visibility filter set to Yours. */
export default function MinePage() {
  redirect("/?visibility=mine");
}
