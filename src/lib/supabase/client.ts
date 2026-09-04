"use client";

import { createBrowserClient } from "@supabase/ssr";
import { cookieOptions } from "./cookies";
import { supabaseKey, supabaseUrl } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Supabase client for Client Components (singleton per tab). */
export function createClient() {
  if (!client) client = createBrowserClient(supabaseUrl(), supabaseKey(), { cookieOptions });
  return client;
}
