import "server-only";

import { z } from "zod";

import { createLiveSource } from "@/lib/llm/anthropic";
import { getLlmConfig } from "@/lib/llm/config";
import { log } from "@/lib/log";
import { sampleSource } from "@/lib/sample";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { createStreamResponse } from "./respond";
import { GENERATION_LIMITS, generationRowSchema, streamRequestSchema } from "./schema";
import {
  generationError,
  getRequestUser,
  isGeneratorConfigured,
  readJson,
  retryAfter,
  withinRateLimit,
} from "./server";
import type { GenerationBrief } from "./types";

const claimSchema = z.object({
  status: z.enum([
    "ok",
    "not_found",
    "type_not_selected",
    "already_streamed",
    "not_started",
    "cap_reached",
  ]),
  generation: z.unknown(),
  attempt: z.number().int(),
  regenerations_left: z.number().int(),
});

const CLAIM_ERRORS = {
  not_found: "not_found",
  type_not_selected: "type_not_selected",
  already_streamed: "already_streamed",
  not_started: "not_started",
  cap_reached: "regeneration_cap_reached",
} as const;

/**
 * Shared handler for the two stream endpoints (spec §5.7):
 *
 *   POST /api/generate/stream       first stream of a (generation, type) — once
 *   POST /api/generate/regenerate   later streams — capped per generation
 *
 * Everything that decides whether the stream may start happens before the first
 * byte is written, so failures are ordinary JSON errors with proper status
 * codes. claim_generation_stream() checks ownership, that the type was
 * selected, and "once" / the regeneration cap, atomically.
 */
export async function handleStreamRequest(
  request: Request,
  { regenerate }: { regenerate: boolean },
): Promise<Response> {
  if (!isGeneratorConfigured()) return generationError("not_configured");

  const user = await getRequestUser();
  if (!user) return generationError("unauthenticated");

  const parsed = streamRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return generationError("invalid_input");
  const { generationId, type } = parsed.data;

  const limit = regenerate ? "regenerate" : "stream";
  if (!(await withinRateLimit(limit, user.id))) {
    return generationError("rate_limited", retryAfter(limit));
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_generation_stream", {
    p_generation: generationId,
    p_user: user.id,
    p_type: type,
    p_regenerate: regenerate,
    p_max_regenerations: GENERATION_LIMITS.maxRegenerations,
  });

  const claim = claimSchema.safeParse(Array.isArray(data) ? data[0] : data);
  if (error || !claim.success) {
    log.error("generation.claim_failed", { code: error?.code ?? "bad_result" });
    return generationError("server_error");
  }
  if (claim.data.status !== "ok") return generationError(CLAIM_ERRORS[claim.data.status]);

  const generation = generationRowSchema.safeParse(claim.data.generation);
  if (!generation.success) {
    log.error("generation.row_invalid", {});
    return generationError("server_error");
  }
  const row = generation.data;

  const brief: GenerationBrief = {
    topic: row.topic,
    tone: row.tone,
    length: row.length,
    language: row.content_language,
    keywords: row.keywords,
    sourceText: row.source_text,
  };

  // The mode was fixed when the generation started. If the key has since been
  // removed (or DEMO_FORCE_SAMPLE switched on), fall back to sample and say so.
  const live = row.mode === "live" && row.model !== null && getLlmConfig().liveEnabled;
  const source = live ? createLiveSource(row.model!) : sampleSource;
  const seed = `${generationId}:${type}:${claim.data.attempt}`;

  return createStreamResponse({
    type,
    meta: {
      mode: live ? "live" : "sample",
      model: live ? row.model : null,
      attempt: claim.data.attempt,
      regenerationsLeft: claim.data.regenerations_left,
    },
    // Sample fixtures have one fixed length, so the word target only applies to live output.
    validateLength: live ? row.length : undefined,
    requestSignal: request.signal,
    open: (signal) => source({ brief, type, seed, signal }),
    async onFinish(outcome) {
      const { error: finishError } = await admin.rpc("finish_generation_stream", {
        p_generation: generationId,
        p_type: type,
        p_input_tokens: outcome.inputTokens,
        p_output_tokens: outcome.outputTokens,
        p_words: outcome.words,
      });
      if (finishError) log.error("generation.finish_rpc_failed", { code: finishError.code });
    },
  });
}
