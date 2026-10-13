import "server-only";

import type { User } from "@supabase/supabase-js";

import { apiError } from "@/lib/api/response";
import { log } from "@/lib/log";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { GenerateErrorCode } from "./errors";

/*
 * Shared plumbing for the generator's API routes: who is calling, are they
 * within their rate limits, and one place that turns an error code into the
 * standard `{ error: { code, message } }` response.
 */

type ErrorSpec = { status: number; message: string };

/** HTTP status and an English fallback message per code (the UI translates the code). */
const ERRORS: Partial<Record<GenerateErrorCode, ErrorSpec>> = {
  unauthenticated: { status: 401, message: "Sign in to continue." },
  invalid_input: { status: 400, message: "The request is not valid." },
  rate_limited: { status: 429, message: "Too many requests. Try again shortly." },
  quota_exhausted: { status: 403, message: "The generation allowance for this plan is used up." },
  length_not_allowed: { status: 403, message: "This length is not included in the current plan." },
  not_configured: { status: 503, message: "The server is not fully configured." },
  server_error: { status: 500, message: "Something went wrong on the server." },
  not_found: { status: 404, message: "Generation not found." },
  already_streamed: { status: 409, message: "This piece has already been generated." },
  type_not_selected: { status: 400, message: "This format was not part of the generation." },
  not_started: { status: 409, message: "This piece has not been generated yet." },
  regeneration_cap_reached: {
    status: 403,
    message: "The regeneration limit for this generation is reached.",
  },
  save_failed: { status: 500, message: "The piece could not be saved." },
};

const SOURCE_ERROR: ErrorSpec = { status: 422, message: "The source URL could not be used." };

export function generationError(code: GenerateErrorCode, headers?: HeadersInit) {
  const spec = ERRORS[code] ?? (code.startsWith("source_") ? SOURCE_ERROR : ERRORS.server_error!);
  return apiError(code, spec.message, spec.status, { "Cache-Control": "no-store", ...headers });
}

export const isGeneratorConfigured = () => isSupabaseConfigured() && isSupabaseAdminConfigured();

/** The signed-in user, verified with the Auth server. Guests count: they are real users. */
export async function getRequestUser(): Promise<User | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch (error) {
    log.error("generation.auth_threw", { name: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

/**
 * Per-user limits on top of the monthly quota. They stop a script from burning
 * through a quota in a second, hammering the stream endpoints, or using the URL
 * fetcher as a port scanner. Windows are fixed (see check_rate_limit).
 */
export const RATE_LIMITS = {
  generate: { windowSeconds: 60, max: 6 },
  stream: { windowSeconds: 60, max: 40 },
  regenerate: { windowSeconds: 60, max: 15 },
  sourceFetch: { windowSeconds: 600, max: 10 },
  save: { windowSeconds: 60, max: 30 },
  demo: { windowSeconds: 60, max: 40 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * True when the caller is within the limit. Fails CLOSED: if the limiter itself
 * cannot be reached, the request is refused rather than let through unmetered.
 */
export async function withinRateLimit(name: RateLimitName, subject: string): Promise<boolean> {
  const { windowSeconds, max } = RATE_LIMITS[name];
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("check_rate_limit", {
      p_key: `${name}:${subject}`,
      p_window_seconds: windowSeconds,
      p_max: max,
    });
    if (error) {
      log.error("rate_limit.failed", { name, code: error.code });
      return false;
    }
    return data === true;
  } catch (error) {
    log.error("rate_limit.threw", {
      name,
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

export const retryAfter = (name: RateLimitName) => ({
  "Retry-After": String(RATE_LIMITS[name].windowSeconds),
});

/** Parses a JSON request body, returning null for anything that is not valid JSON. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
