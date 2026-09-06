import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Service-role client for jobs that run without a user (the weekly digest
 * cron). Bypasses RLS, so it lives in exactly one place and every caller must
 * scope its own reads (the digest only ever selects public items).
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSupabaseClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
