"use client";

import { createBrowserClient } from "@supabase/ssr";
import { cookieOptionsFor } from "./cookies";
import { supabaseKey, supabaseUrl } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

function inFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Supabase client for Client Components (singleton per tab). */
export function createClient() {
  if (!client) {
    client = createBrowserClient(supabaseUrl(), supabaseKey(), { cookieOptions: cookieOptionsFor(inFrame()) });
  }
  return client;
}
