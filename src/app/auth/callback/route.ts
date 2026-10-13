import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { mapAuthError, type AuthErrorCode } from "@/lib/auth/errors";
import { safeNextPath } from "@/lib/auth/redirect";
import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Landing point for every auth round-trip: Google OAuth, email confirmation,
 * password recovery, and guest → account upgrades.
 *
 * Supports both link styles Supabase can send:
 *   ?code=…                     PKCE (OAuth and the default email templates)
 *   ?token_hash=…&type=…        custom email templates (works across devices)
 */

const querySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  token_hash: z.string().min(1).max(2048).optional(),
  type: z.enum(["signup", "invite", "magiclink", "recovery", "email_change", "email"]).optional(),
  next: z.string().max(512).optional(),
  error: z.string().max(256).optional(),
  error_code: z.string().max(128).optional(),
});

function redirectTo(request: NextRequest, path: string): NextResponse {
  // `path` is always a sanitised same-site path, resolved against our own origin.
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

const loginError = (request: NextRequest, code: AuthErrorCode) =>
  redirectTo(request, `/login?error=${code}`);

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) return loginError(request, "not_configured");

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return loginError(request, "link_expired");
  const query = parsed.data;
  const next = safeNextPath(query.next);

  // The provider or Supabase sent the user back with an error.
  if (query.error || query.error_code) {
    const code = query.error_code ? mapAuthError({ code: query.error_code }) : "unknown";
    log.warn("auth.callback_error_param", { code, supabase_code: query.error_code });
    return loginError(request, code === "unknown" ? "link_expired" : code);
  }

  try {
    const supabase = await createSupabaseServerClient();

    if (query.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(query.code);
      if (error) {
        log.warn("auth.callback_exchange_failed", { supabase_code: error.code });
        return loginError(request, "link_expired");
      }
      return redirectTo(request, next);
    }

    if (query.token_hash && query.type) {
      const { error } = await supabase.auth.verifyOtp({
        type: query.type,
        token_hash: query.token_hash,
      });
      if (error) {
        log.warn("auth.callback_verify_failed", { supabase_code: error.code });
        return loginError(request, "link_expired");
      }
      return redirectTo(request, next);
    }
  } catch (error) {
    log.error("auth.callback_threw", { name: error instanceof Error ? error.name : "unknown" });
    return loginError(request, "unavailable");
  }

  return loginError(request, "link_expired");
}
