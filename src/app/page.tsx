import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PromptList } from "@/components/PromptList";
import { ToastFromQuery } from "@/components/Toast";
import { getCurrentUser, listPrompts } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const prompts = await listPrompts();

  return (
    <div className="container">
      <Header user={user} active="discover" />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>
      <Suspense fallback={null}>
        <PromptList view="discover" prompts={prompts} me={user} />
      </Suspense>
    </div>
  );
}
