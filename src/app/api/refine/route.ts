import { z } from "zod";

import { createStreamResponse } from "@/lib/generation/respond";
import {
  generationError,
  getRequestUser,
  isGeneratorConfigured,
  readJson,
  retryAfter,
  withinRateLimit,
} from "@/lib/generation/server";
import { streamLiveText } from "@/lib/llm/anthropic";
import { getLlmConfig } from "@/lib/llm/config";
import { log } from "@/lib/log";
import { CONTENT_TYPES } from "@/lib/presets";
import { buildRefinePrompt, refineMaxTokens } from "@/lib/refine/prompts";
import { sampleRefine } from "@/lib/refine/sample";
import { REFINE_LIMITS, refineRequestSchema } from "@/lib/refine/schema";
import { simulateStream } from "@/lib/sample";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// A refine rewrites at most one piece (capped max_tokens), so it normally ends
// well inside a minute; the margin covers a slow model on a Long blog post.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const claimSchema = z.object({
  status: z.enum(["ok", "not_found", "cap_reached", "sample_unsupported"]),
  content: z.object({ type: z.enum(CONTENT_TYPES) }).nullable(),
  mode: z.enum(["live", "sample"]).nullable(),
  model: z.string().nullable(),
  refinements_left: z.number().int().nullable(),
});

const CLAIM_ERRORS = {
  not_found: "not_found",
  cap_reached: "refinement_cap_reached",
  sample_unsupported: "sample_unsupported",
} as const;

/**
 * POST /api/refine — Shorten, Expand, Change tone or Translate a saved piece
 * (or a passage of it), streamed back as a suggestion (spec §4.3).
 *
 *   validate → rate limit → claim_refinement() → stream
 *
 * Same SSE protocol as the generator (meta, delta, done, error). The text comes
 * from the editor, because it may hold changes that are not saved yet; the
 * content id is what is authorised. claim_refinement() checks ownership,
 * counts the refine against the generation's cap of 10 when the piece came
 * from one, and decides live vs sample — atomically, before the first byte.
 */
export async function POST(request: Request) {
  if (!isGeneratorConfigured()) return generationError("not_configured");

  const user = await getRequestUser();
  if (!user) return generationError("unauthenticated");

  const parsed = refineRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return generationError("invalid_input");
  const input = parsed.data;

  if (!(await withinRateLimit("refine", user.id))) {
    return generationError("rate_limited", retryAfter("refine"));
  }
  if (!(await withinRateLimit("refineDaily", user.id))) {
    return generationError("rate_limited", retryAfter("refineDaily"));
  }

  const llm = getLlmConfig();

  const { data, error } = await createSupabaseAdminClient().rpc("claim_refinement", {
    p_user: user.id,
    p_content: input.contentId,
    p_max_refinements: REFINE_LIMITS.maxPerGeneration,
    p_want_live: llm.liveEnabled,
    p_daily_cap: llm.dailyRefineCap,
    // Sample mode cannot translate arbitrary text; such a request is refused uncounted.
    p_sample_ok: input.action !== "translate" || sampleTranslationExists(input),
    p_model_free: llm.modelFree,
    p_model_pro: llm.modelPro,
  });

  const claim = claimSchema.safeParse(Array.isArray(data) ? data[0] : data);
  if (error || !claim.success) {
    log.error("refine.claim_failed", { code: error?.code ?? "bad_result" });
    return generationError("server_error");
  }
  if (claim.data.status !== "ok") return generationError(CLAIM_ERRORS[claim.data.status]);
  if (!claim.data.content) {
    log.error("refine.claim_empty", {});
    return generationError("server_error");
  }

  const { type } = claim.data.content;
  const model = claim.data.model;
  const live = claim.data.mode === "live" && model !== null;

  const canned = live ? null : sampleRefine({ ...input, type });
  if (!live && canned === null) return generationError("sample_unsupported");

  const prompt = live ? buildRefinePrompt(input, type) : null;

  return createStreamResponse({
    type,
    meta: {
      mode: live ? "live" : "sample",
      model: live ? model : null,
      attempt: 1,
      regenerationsLeft: claim.data.refinements_left,
    },
    // A passage is not a whole piece: the format check only makes sense for "all".
    validate: input.scope === "all",
    requestSignal: request.signal,
    open: (signal) =>
      live && prompt
        ? streamLiveText({
            model: model!,
            system: prompt.system,
            user: prompt.user,
            maxTokens: refineMaxTokens(input.action, input.text.length),
            signal,
          })
        : simulateStream(canned ?? "", `${input.contentId}:${input.action}`, signal),
    async onFinish(outcome) {
      // Counts only — never the text.
      if (live) {
        log.warn("refine.usage", {
          action: input.action,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          aborted: outcome.aborted,
        });
      }
    },
  });
}

function sampleTranslationExists(input: z.infer<typeof refineRequestSchema>): boolean {
  // The type does not matter for the lookup: fixtures are matched by their text.
  return sampleRefine({ ...input, type: "blog" }) !== null;
}
