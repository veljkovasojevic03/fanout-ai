import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { GENERATION_LIMITS } from "@/lib/generation/schema";
import { TONES } from "@/lib/presets";

/* Request shape for POST /api/refine, shared by the editor and the route. */

export const REFINE_ACTIONS = ["shorten", "expand", "tone", "translate"] as const;
export type RefineAction = (typeof REFINE_ACTIONS)[number];

export const REFINE_SCOPES = ["selection", "all"] as const;
export type RefineScope = (typeof REFINE_SCOPES)[number];

export const REFINE_LIMITS = {
  /** Longest text one refine may send. A Long blog post in Serbian fits. */
  textMax: 12_000,
  /** Shared with regenerate: 10 per generation (spec §4.2). */
  maxPerGeneration: GENERATION_LIMITS.maxRegenerations,
} as const;

export const refineRequestSchema = z
  .object({
    contentId: z.uuid(),
    action: z.enum(REFINE_ACTIONS),
    /** Whether `text` is the whole piece or a passage selected in the editor. */
    scope: z.enum(REFINE_SCOPES),
    /** The text as it is in the editor right now — it may not be saved yet. */
    text: z
      .string()
      .max(REFINE_LIMITS.textMax)
      .refine((value) => /\S/.test(value)),
    /** The language `text` is written in. */
    language: z.enum(APP_LOCALES),
    /** Required for `tone`. */
    tone: z.enum(TONES).optional(),
    /** Required for `translate`. */
    targetLanguage: z.enum(APP_LOCALES).optional(),
  })
  .refine((value) => value.action !== "tone" || value.tone !== undefined)
  .refine(
    (value) =>
      value.action !== "translate" ||
      (value.targetLanguage !== undefined && value.targetLanguage !== value.language),
  );

export type RefineRequest = z.infer<typeof refineRequestSchema>;
