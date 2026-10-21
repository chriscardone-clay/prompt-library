import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PromptList } from "@/components/PromptList";
import { ToastFromQuery } from "@/components/Toast";
import { canEdit, getCatalog, getCurrentUser, listPrompts, workflowsEnabled } from "@/lib/data";
import { shouldNudgeToSlack } from "@/lib/slackNudge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Created" };

export default async function MinePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [all, catalog, nudge, workflowsOn] = await Promise.all([listPrompts(), getCatalog(), shouldNudgeToSlack(user), workflowsEnabled()]);
  const mine = all.filter((p) => canEdit(p, user));

  return (
    <div className="container">
      <Header user={user} active="mine" slackNudge={nudge} />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>
      <Suspense fallback={null}>
        <PromptList view="mine" prompts={mine} allPrompts={all} me={user} catalog={catalog} workflowsOn={workflowsOn} />
      </Suspense>
    </div>
  );
}
