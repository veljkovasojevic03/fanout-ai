import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { CONTENT_TYPES, LENGTHS, TONES } from "@/lib/presets";

/*
 * Request shapes for the generator API. Shared by the form (for instant
 * feedback) and the routes (as the actual gate) — the server never trusts that
 * the browser ran these.
 */

export const GENERATION_LIMITS = {
  topicMax: 300,
  keywordsMax: 8,
  keywordMax: 40,
  sourceTextMax: 8000,
  sourceUrlMax: 2048,
  /** Regenerate + refine share this budget, per generation (spec §4.2). */
  maxRegenerations: 10,
} as const;

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const keyword = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(GENERATION_LIMITS.keywordMax));

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("url"),
    url: z.string().trim().min(1).max(GENERATION_LIMITS.sourceUrlMax),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().trim().min(1).max(GENERATION_LIMITS.sourceTextMax),
  }),
]);

export const generateRequestSchema = z.object({
  topic: z.string().trim().min(1).max(GENERATION_LIMITS.topicMax),
  tone: z.enum(TONES),
  length: z.enum(LENGTHS),
  contentLanguage: z.enum(APP_LOCALES),
  keywords: z
    .array(keyword)
    .max(GENERATION_LIMITS.keywordsMax)
    .default([])
    .transform((values) => unique(values)),
  types: z
    .array(z.enum(CONTENT_TYPES))
    .min(1)
    .max(CONTENT_TYPES.length)
    .transform((values) => unique(values)),
  source: source.default({ kind: "none" }),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
export type GenerateRequestInput = z.input<typeof generateRequestSchema>;

export const streamRequestSchema = z.object({
  generationId: z.uuid(),
  type: z.enum(CONTENT_TYPES),
});

export type StreamRequest = z.infer<typeof streamRequestSchema>;

/** What POST /api/generate answers with. */
export const generateResponseSchema = z.object({
  generationId: z.uuid(),
  mode: z.enum(["live", "sample"]),
  types: z.array(z.enum(CONTENT_TYPES)),
  remaining: z.number().int(),
});

export type GenerateResponse = z.infer<typeof generateResponseSchema>;

/** The generations row as returned (jsonb) by claim_generation_stream(). */
export const generationRowSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  tone: z.enum(TONES),
  length: z.enum(LENGTHS),
  content_language: z.enum(APP_LOCALES),
  keywords: z.array(z.string()),
  source_text: z.string().nullable(),
  mode: z.enum(["live", "sample"]),
  model: z.string().nullable(),
});

/** Payloads of the SSE events on /api/generate/stream. */
export const streamMetaSchema = z.object({
  mode: z.enum(["live", "sample"]),
  model: z.string().nullable(),
  attempt: z.number().int(),
  regenerationsLeft: z.number().int().nullable(),
});
export type StreamMeta = z.infer<typeof streamMetaSchema>;

export const contractWarningSchema = z.object({
  code: z.string(),
  values: z.record(z.string(), z.number()),
});

export const streamDoneSchema = z.object({
  words: z.number().int(),
  chars: z.number().int(),
  /** Contract violations found by the server in the finished text (spec §5.11). */
  warnings: z.array(contractWarningSchema),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
});
export type StreamDone = z.infer<typeof streamDoneSchema>;
