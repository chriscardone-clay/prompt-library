import { NextResponse, type NextRequest } from "next/server";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

/**
 * Second leg of the embedded sign-in: the iframe posts the one-time code it
 * received from the popup. The PKCE verifier cookie was set in this same
 * cookie partition by beginEmbedSignIn, so the exchange succeeds here and the
 * session cookies are written into the embed's partition.
 */
export async function POST(request: NextRequest) {
  let code: string | undefined;
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : undefined;
  } catch {
    /* fall through */
  }
  if (!code) return NextResponse.json({ error: "Missing code." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    const msg = error?.message ?? "";
    const kind = /accounts can sign in|Database error/i.test(msg) ? "domain" : "oauth";
    return NextResponse.json({ error: kind }, { status: 401 });
  }

  const email = data.user.email?.toLowerCase() ?? "";
  if (!email.endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "domain" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
