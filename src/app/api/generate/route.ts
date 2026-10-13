import { z } from "zod";

import { apiOk } from "@/lib/api/response";
import { generateRequestSchema, type GenerateResponse } from "@/lib/generation/schema";
import {
  generationError,
  getRequestUser,
  isGeneratorConfigured,
  readJson,
  retryAfter,
  withinRateLimit,
} from "@/lib/generation/server";
import { getLlmConfig } from "@/lib/llm/config";
import { log } from "@/lib/log";
import { fetchSource, SourceFetchError } from "@/lib/source/fetch-url";
import { nodeSourceDeps } from "@/lib/source/node-transport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// The URL source fetch has an 8 s deadline; everything else is a couple of queries.
export const maxDuration = 30;

const startResultSchema = z.object({
  status: z.enum(["ok", "no_profile", "length_not_allowed", "quota_exhausted"]),
  generation_id: z.uuid().nullable(),
  mode: z.enum(["live", "sample"]).nullable(),
  remaining: z.number().int(),
});

/**
 * POST /api/generate — one click, one generation (spec §5.7).
 *
 *   validate → rate limit → (fetch URL source) → start_generation()
 *
 * start_generation() is the atomic part: plan gating, the quota, the global
 * daily cap that decides live vs sample, and the generations row, in one
 * transaction. The URL is fetched BEFORE it, so a page that cannot be read
 * never costs the user a generation.
 */
export async function POST(request: Request) {
  if (!isGeneratorConfigured()) return generationError("not_configured");

  const user = await getRequestUser();
  if (!user) return generationError("unauthenticated");

  const parsed = generateRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return generationError("invalid_input");
  const input = parsed.data;

  if (!(await withinRateLimit("generate", user.id))) {
    return generationError("rate_limited", retryAfter("generate"));
  }

  let sourceUrl: string | null = null;
  let sourceText: string | null = null;

  if (input.source.kind === "text") {
    sourceText = input.source.text;
  } else if (input.source.kind === "url") {
    if (!(await withinRateLimit("sourceFetch", user.id))) {
      return generationError("rate_limited", retryAfter("sourceFetch"));
    }
    try {
      const fetched = await fetchSource(input.source.url, nodeSourceDeps);
      sourceUrl = fetched.url;
      sourceText = fetched.text;
    } catch (error) {
      if (error instanceof SourceFetchError) {
        // The code only — never the URL, which may be private to the user.
        log.warn("generation.source_rejected", { code: error.code });
        return generationError(error.code);
      }
      log.error("generation.source_threw", {
        name: error instanceof Error ? error.name : "unknown",
      });
      return generationError("source_unreachable");
    }
  }

  const llm = getLlmConfig();

  const { data, error } = await createSupabaseAdminClient().rpc("start_generation", {
    p_user: user.id,
    p_topic: input.topic,
    p_tone: input.tone,
    p_length: input.length,
    p_content_language: input.contentLanguage,
    p_keywords: input.keywords,
    p_source_kind: input.source.kind,
    p_source_url: sourceUrl,
    p_source_text: sourceText,
    p_types: input.types,
    p_want_live: llm.liveEnabled,
    p_daily_cap: llm.dailyCap,
    p_model_free: llm.modelFree,
    p_model_pro: llm.modelPro,
  });

  const row = startResultSchema.safeParse(Array.isArray(data) ? data[0] : data);
  if (error || !row.success) {
    log.error("generation.start_failed", { code: error?.code ?? "bad_result" });
    return generationError("server_error");
  }

  const result = row.data;
  if (result.status === "quota_exhausted") return generationError("quota_exhausted");
  if (result.status === "length_not_allowed") return generationError("length_not_allowed");
  if (result.status !== "ok" || !result.generation_id || !result.mode) {
    log.error("generation.start_rejected", { status: result.status });
    return generationError("server_error");
  }

  const body: GenerateResponse = {
    generationId: result.generation_id,
    mode: result.mode,
    types: input.types,
    remaining: result.remaining,
  };
  return apiOk(body, { "Cache-Control": "no-store" });
}
