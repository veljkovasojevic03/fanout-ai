import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv, SupabaseNotConfiguredError } from "./env";

/**
 * Supabase client for Client Components. Uses the anon key and the user's
 * session cookies; everything it can do is bounded by RLS and column grants.
 */
export function createSupabaseBrowserClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return createBrowserClient(env.url, env.anonKey);
}
