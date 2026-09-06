import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { PromptList } from "@/components/PromptList";
import { ToastFromQuery } from "@/components/Toast";
import { getCatalog, getCurrentUser, listPrompts } from "@/lib/data";
import { shouldNudgeToSlack } from "@/lib/slackNudge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Favorites" };

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [all, catalog, nudge] = await Promise.all([listPrompts(), getCatalog(), shouldNudgeToSlack(user)]);
  const saved = all.filter((p) => p.favoritedBy.includes(user.id));

  return (
    <div className="container">
      <Header user={user} active="favorites" slackNudge={nudge} />
      <Suspense fallback={null}>
        <ToastFromQuery />
      </Suspense>
      <Suspense fallback={null}>
        <PromptList view="favorites" prompts={saved} allPrompts={all} me={user} catalog={catalog} />
      </Suspense>
    </div>
  );
}
