import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PromptList } from "@/components/PromptList";
import { ToastFromQuery } from "@/components/Toast";
import { getCatalog, getCurrentUser, listPrompts, workflowsEnabled } from "@/lib/data";
import { shouldNudgeToSlack } from "@/lib/slackNudge";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [prompts, catalog, nudge, workflowsOn] = await Promise.all([listPrompts(), getCatalog(), shouldNudgeToSlack(user), workflowsEnabled()]);

  return (
    <div className="container">
      <Header user={user} active="discover" slackNudge={nudge} />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>
      <Suspense fallback={null}>
        <PromptList view="discover" prompts={prompts} me={user} catalog={catalog} workflowsOn={workflowsOn} />
      </Suspense>
    </div>
  );
}
