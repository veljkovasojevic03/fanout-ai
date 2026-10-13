/**
 * Public Supabase configuration. Safe to import anywhere (client or server):
 * both values are designed to be exposed to the browser and are protected by RLS.
 *
 * The `process.env.NEXT_PUBLIC_*` reads must stay literal so Next.js can inline
 * them into the client bundle.
 */
export type SupabasePublicEnv = { url: string; anonKey: string };

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** False until the Supabase env vars are set; the UI then explains what is missing. */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase environment variables are not set.");
    this.name = "SupabaseNotConfiguredError";
  }
}
