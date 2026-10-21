import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cookieOptionsFor, isEmbeddedRequest } from "./cookies";
import { supabaseKey, supabaseUrl } from "./env";

export interface ServerClientOptions {
  /**
   * Use the embedded (Partitioned) cookie jar even before the embed marker
   * exists, i.e. while the embed is signing in. Otherwise the jar is picked
   * from the request (see ./cookies.ts).
   */
  embed?: boolean;
}

/** Supabase client for Server Components, Route Handlers and Server Actions. */
export async function createClient(opts: ServerClientOptions = {}) {
  const cookieStore = await cookies();
  const embedded = opts.embed ?? isEmbeddedRequest(cookieStore);
  return createServerClient(supabaseUrl(), supabaseKey(), {
    cookieOptions: cookieOptionsFor(embedded),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy (src/proxy.ts) refreshes the session on the next request.
        }
      },
    },
  });
}
