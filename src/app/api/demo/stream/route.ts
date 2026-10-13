import { createHash } from "node:crypto";

import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { createStreamResponse } from "@/lib/generation/respond";
import { generationError, readJson, retryAfter, withinRateLimit } from "@/lib/generation/server";
import { CONTENT_TYPES } from "@/lib/presets";
import { FIXTURE_IDS, fixtureText, simulateStream, type FixtureId } from "@/lib/sample";
import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  fixture: z.enum(FIXTURE_IDS as [FixtureId, ...FixtureId[]]),
  type: z.enum(CONTENT_TYPES),
  language: z.enum(APP_LOCALES),
  /** Lets "regenerate" in the demo vary the timing; has no other effect. */
  attempt: z.number().int().min(1).max(50).default(1),
});

/** A rate-limit key for a visitor with no account. The raw IP is never stored. */
function visitorKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`fanout-demo:${ip}`).digest("hex").slice(0, 32);
}

/**
 * POST /api/demo/stream — the public, no-login demo stream.
 *
 * It can only replay the hand-written fixtures: the request picks one by id, so
 * there is no free text, no database write and no model call to abuse. It is
 * still rate limited per visitor, because an open streaming endpoint is an easy
 * way to hold connections open.
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return generationError("invalid_input");
  const { fixture, type, language, attempt } = parsed.data;

  // Without database credentials (local development) there is nothing to count against.
  if (isSupabaseAdminConfigured() && !(await withinRateLimit("demo", visitorKey(request)))) {
    return generationError("rate_limited", retryAfter("demo"));
  }

  const text = fixtureText(fixture, language, type);

  return createStreamResponse({
    type,
    meta: { mode: "sample", model: null, attempt, regenerationsLeft: null },
    requestSignal: request.signal,
    open: (signal) =>
      simulateStream(text, `demo:${fixture}:${language}:${type}:${attempt}`, signal),
  });
}
