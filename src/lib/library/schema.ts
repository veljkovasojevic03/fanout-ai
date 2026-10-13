import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { CONTENT_TYPES, TONES } from "@/lib/presets";

import { normalizeTags, TAG_LIMITS } from "./tags";

/* Shapes of library rows and of the editor's save request. */

export const CONTENT_LIMITS = { titleMax: 200, bodyMax: 100_000 } as const;

export const contentListItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(CONTENT_TYPES),
  title: z.string(),
  language: z.enum(APP_LOCALES),
  tags: z.array(z.string()),
  word_count: z.number().int(),
  updated_at: z.string(),
});
export type ContentListItem = z.infer<typeof contentListItemSchema>;

export const contentRowSchema = contentListItemSchema.extend({
  body_md: z.string(),
  tone: z.enum(TONES).nullable(),
  generation_id: z.uuid().nullable(),
  created_at: z.string(),
});
export type ContentRow = z.infer<typeof contentRowSchema>;

/** What the editor's autosave sends. Tags are normalised again on the server. */
export const contentUpdateSchema = z.object({
  id: z.uuid(),
  title: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(CONTENT_LIMITS.titleMax)),
  body: z.string().max(CONTENT_LIMITS.bodyMax),
  language: z.enum(APP_LOCALES),
  tags: z
    .array(z.string().max(200))
    .max(TAG_LIMITS.maxPerContent * 2)
    .transform((values) => normalizeTags(values)),
});
export type ContentUpdate = z.input<typeof contentUpdateSchema>;

export const LIBRARY_ERROR_CODES = [
  "unauthenticated",
  "invalid_input",
  "title_required",
  "rate_limited",
  "not_found",
  "not_configured",
  "save_failed",
  "delete_failed",
  "duplicate_failed",
] as const;
export type LibraryErrorCode = (typeof LIBRARY_ERROR_CODES)[number];

/** "Title (copy)", clipped so the suffix always survives the 200-character limit. */
export function copyTitle(title: string, suffix: string): string {
  const tail = ` (${suffix})`;
  const room = CONTENT_LIMITS.titleMax - Array.from(tail).length;
  return `${Array.from(title).slice(0, room).join("").trimEnd()}${tail}`;
}
