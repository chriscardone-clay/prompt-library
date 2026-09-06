import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cookieOptions } from "./cookies";
import { supabaseKey, supabaseUrl } from "./env";

export interface ServerClientOptions {
  /**
   * How to store the PKCE code-verifier cookie written when a sign-in starts.
   *
   * - "lax" (default): a plain first-party cookie. It only has to survive the
   *   top-level round trip Google → Supabase → /auth/callback, and SameSite=Lax
   *   is sent on that navigation by every browser, including in-app browsers
   *   and older Safari/Firefox that mishandle the Partitioned attribute.
   * - "partitioned": SameSite=None + Partitioned, required when the sign-in
   *   starts inside an iframe (the Notion embed), where a Lax cookie would
   *   never be stored.
   */
  pkceCookie?: "lax" | "partitioned";
}

/** Supabase client for Server Components, Route Handlers and Server Actions. */
export async function createClient(opts: ServerClientOptions = {}) {
  const cookieStore = await cookies();
  const pkceCookie = opts.pkceCookie ?? "lax";
  return createServerClient(supabaseUrl(), supabaseKey(), {
    cookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            const isVerifier = name.endsWith("-code-verifier");
            cookieStore.set(
              name,
              value,
              isVerifier && pkceCookie === "lax"
                ? { ...options, sameSite: "lax", partitioned: false }
                : options,
            );
          }
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy (src/proxy.ts) refreshes the session on the next request.
        }
      },
    },
  });
}
