import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "./env";

type SessionResult = {
  /** Pass this response on (or copy its cookies) so refreshed tokens reach the browser. */
  response: NextResponse;
  userId: string | null;
  /**
   * The Auth server could not be reached, so "no user" does not mean "signed
   * out". Callers must not redirect to login on this; the app shows the
   * "Demo is waking up" screen instead.
   */
  unavailable: boolean;
};

/**
 * Refreshes the Supabase session for this request and reports who is signed in.
 * Runs in the proxy, before any rendering, so Server Components always see a
 * fresh token and the rotated cookies are written back to the browser.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  const env = getSupabasePublicEnv();
  if (!env) return { response, userId: null, unavailable: false };

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Cache-Control: no-store etc. — a response that sets auth cookies must never be cached.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  try {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims.sub;
    if (typeof sub === "string") return { response, userId: sub, unavailable: false };
    const outage = error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500;
    return { response, userId: null, unavailable: outage };
  } catch {
    // Auth server unreachable (e.g. the free-tier project is paused).
    return { response, userId: null, unavailable: true };
  }
}
