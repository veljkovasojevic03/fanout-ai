import { z } from "zod";

import type { FieldErrorCode } from "./errors";

/*
 * Validation for every auth form. Runs on the server in each Server Action;
 * the messages are field error codes, translated in the UI.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email({ error: "email_invalid" satisfies FieldErrorCode })
      .max(254, { error: "email_invalid" }),
  );

// bcrypt (used by Supabase Auth) only reads the first 72 bytes of a password.
const newPassword = z
  .string()
  .min(8, { error: "password_too_short" satisfies FieldErrorCode })
  .max(72, { error: "password_too_long" satisfies FieldErrorCode });

// For sign-in we only check presence: old passwords may predate today's rules.
const existingPassword = z
  .string()
  .min(1, { error: "password_too_short" satisfies FieldErrorCode })
  .max(1024, { error: "password_too_long" satisfies FieldErrorCode });

const captchaToken = z.string().max(4096).optional();
const next = z.string().max(512).optional();

export const signInSchema = z.object({ email, password: existingPassword, captchaToken, next });
export const signUpSchema = z.object({ email, password: newPassword, captchaToken, next });
export const guestSchema = z.object({ captchaToken });
export const resetRequestSchema = z.object({ email, captchaToken });
export const updatePasswordSchema = z.object({ password: newPassword });
export const upgradeEmailSchema = z.object({ email });
export const oauthSchema = z.object({ next });

/** Reads the named fields from a FormData as plain strings (files are ignored). */
export function formValues(formData: FormData, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

/** First error code per field, e.g. `{ email: "email_invalid" }`. */
export function fieldErrors(error: z.ZodError): Record<string, FieldErrorCode> {
  const result: Record<string, FieldErrorCode> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in result)) {
      result[field] = issue.message as FieldErrorCode;
    }
  }
  return result;
}
