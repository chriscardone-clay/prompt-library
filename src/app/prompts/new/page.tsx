import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { PromptEditor } from "@/components/PromptEditor";
import { getCurrentUser } from "@/lib/data";
import { personFromProfile } from "@/lib/people";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New prompt" };

export default async function NewPromptPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const me = personFromProfile(user);

  return (
    <div className="container">
      <Header user={user} />
      <PromptEditor
        mode="create"
        initial={{
          title: "",
          description: "",
          body: "",
          apps: [{ app: "Claude", surfaces: [] }],
          audience: "GTM",
          visibility: "public",
          forkNote: "",
          editors: [],
        }}
        owner={me}
        me={me}
        people={[]}
        cancelHref="/"
      />
    </div>
  );
}
