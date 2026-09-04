import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PromptList } from "@/components/PromptList";
import { ToastFromQuery } from "@/components/Toast";
import { canEdit, getCurrentUser, listPrompts } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My prompts" };

export default async function MinePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const all = await listPrompts();
  const mine = all.filter((p) => canEdit(p, user));

  return (
    <div className="container">
      <Header user={user} active="mine" />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>
      <Suspense fallback={null}>
        <PromptList view="mine" prompts={mine} allPrompts={all} me={user} />
      </Suspense>
    </div>
  );
}
