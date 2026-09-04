import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { Header } from "@/components/Header";
import { getCatalog, getCatalogUsage, getCurrentUser, isAdmin } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Non-admins get a 404, not a hint that the page exists.
  if (!(await isAdmin())) notFound();

  const supabase = await createClient();
  const [catalog, usage, adminsRes] = await Promise.all([
    getCatalog(),
    getCatalogUsage(),
    supabase.from("admins").select("email").order("email"),
  ]);
  const admins = ((adminsRes.data ?? []) as { email: string }[]).map((a) => a.email);

  return (
    <div className="container">
      <Header user={user} />
      <AdminPanel catalog={catalog} usage={usage} admins={admins} meEmail={user.email.toLowerCase()} />
    </div>
  );
}
