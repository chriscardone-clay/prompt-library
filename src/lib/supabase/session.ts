import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/constants";
import { cookieOptions } from "./cookies";
import { supabaseKey, supabaseUrl } from "./env";

const PUBLIC_PATHS = ["/login", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Refreshes the Supabase session cookie on every request and gates the app:
 * unauthenticated → /login, authenticated on /login → /.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims validates the JWT locally (no network round-trip in the common case).
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.toLowerCase() ?? null;
  const signedIn = !!data?.claims?.sub;
  const allowed = signedIn && !!email && email.endsWith("@" + ALLOWED_EMAIL_DOMAIN);

  const { pathname, search } = request.nextUrl;

  if (!allowed && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (signedIn) url.searchParams.set("error", "domain");
    else if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (allowed && pathname === "/login") {
    // Already signed in: continue to the requested page (e.g. the embed hand-off).
    const next = request.nextUrl.searchParams.get("next") ?? "/";
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return NextResponse.redirect(new URL(safeNext, request.nextUrl.origin));
  }

  return response;
}
