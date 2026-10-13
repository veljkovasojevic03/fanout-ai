import "server-only";

import { createClient } from "@supabase/supabase-js";

import { SupabaseNotConfiguredError } from "./env";

/**
 * Service-role client. BYPASSES RLS — it can read and write everything.
 *
 * Rules:
 *  - Only import this from server routes/actions that have already authenticated
 *    the caller and checked ownership themselves.
 *  - `server-only` makes the build fail if this module is ever pulled into a
 *    Client Component, so the key cannot leak into the browser bundle.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new SupabaseNotConfiguredError();

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
