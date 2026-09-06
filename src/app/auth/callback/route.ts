import { NextResponse, type NextRequest } from "next/server";
import { syncAvatarOnLogin } from "@/lib/avatars";
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
    const verifierMissing = error?.name === "AuthPKCECodeVerifierMissingError" || /code verifier/i.test(msg);
    const kind = /accounts can sign in|Database error/i.test(msg) ? "domain" : verifierMissing ? "verifier" : "oauth";
    const retried = searchParams.get("retry") === "1";
    console.error("[auth] code exchange failed", {
      kind,
      retried,
      name: error?.name,
      message: msg,
      hadVerifierCookie: request.cookies.getAll().some((c) => c.name.includes("code-verifier")),
      cookieNames: request.cookies.getAll().map((c) => c.name),
      userAgent: request.headers.get("user-agent"),
    });

    if (verifierMissing && !retried) {
      // The browser came back from Google without the cookie that holds the
      // PKCE verifier (typically a sign-in that started in one browser context
      // and finished in another, e.g. an in-app browser). Start one fresh
      // flow from this top-level page: the verifier is stored as a plain
      // first-party cookie here, and Google already knows the account, so the
      // round trip is instant. `retry=1` guarantees we never loop.
      const { data: again } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}&retry=1`,
          skipBrowserRedirect: true,
          queryParams: { hd: ALLOWED_EMAIL_DOMAIN },
        },
      });
      if (again?.url) return NextResponse.redirect(again.url);
    }

    return NextResponse.redirect(`${origin}/login?error=${kind}`);
  }

  const email = data.user.email?.toLowerCase() ?? "";
  if (!email.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  await syncAvatarOnLogin(supabase, data.user.id, email);
  return NextResponse.redirect(`${origin}${next}`);
}
