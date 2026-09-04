import { NextResponse, type NextRequest } from "next/server";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { getRequestOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

/** OAuth return leg: exchange the code for a session, then enforce the domain rule. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Use the host the browser actually hit, not the internal request URL.
  const origin = await getRequestOrigin();
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    const reason = searchParams.get("error_description") || searchParams.get("error") || "oauth";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    // The database trigger rejects non-Clay accounts; surface that as a domain error.
    const msg = error?.message ?? "";
    const kind = /accounts can sign in|Database error/i.test(msg) ? "domain" : "oauth";
    return NextResponse.redirect(`${origin}/login?error=${kind}`);
  }

  const email = data.user.email?.toLowerCase() ?? "";
  if (!email.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
