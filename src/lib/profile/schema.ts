import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { TONES } from "@/lib/presets";

/**
 * The profile fields a user may edit — exactly the columns the database grants
 * UPDATE on. Anything else in the submitted form (plan, stripe ids…) is dropped
 * here, and would be refused by Postgres anyway.
 */
export const profileUpdateSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, { error: "name_too_long" })
    // An empty name clears it; the column is nullable.
    .transform((value) => (value === "" ? null : value)),
  ui_language: z.enum(APP_LOCALES),
  default_content_language: z.enum(APP_LOCALES),
  default_tone: z.enum(TONES),
});

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const PROFILE_FIELDS = [
  "display_name",
  "ui_language",
  "default_content_language",
  "default_tone",
] as const;

export type ProfileErrorCode = "invalid_input" | "session_missing" | "save_failed";

export type ProfileFormState =
  | { status: "idle" }
  | { status: "success"; at: number }
  | { status: "error"; code: ProfileErrorCode; nameTooLong?: boolean; at: number };
