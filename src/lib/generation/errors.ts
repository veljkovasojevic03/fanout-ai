import { SOURCE_ERROR_CODES } from "@/lib/source/fetch-url";

import { STREAM_ERROR_CODES } from "./types";

/**
 * Every error code the generator can show. Each has a translation under
 * `generate.errors` in both languages (enforced by a unit test), so the UI
 * never has to display a raw server message.
 */
export const GENERATE_ERROR_CODES = [
  // request-level (HTTP error responses)
  "unauthenticated",
  "invalid_input",
  "rate_limited",
  "quota_exhausted",
  "length_not_allowed",
  "not_configured",
  "server_error",
  // stream claims
  "not_found",
  "already_streamed",
  "type_not_selected",
  "not_started",
  "regeneration_cap_reached",
  // saving to the library
  "save_failed",
  // refine (POST /api/refine)
  "refinement_cap_reached",
  "sample_unsupported",
  // client-side only: the connection dropped or the response was unreadable
  "network_error",
  ...SOURCE_ERROR_CODES,
  ...STREAM_ERROR_CODES,
] as const;

export type GenerateErrorCode = (typeof GENERATE_ERROR_CODES)[number];

export function isGenerateErrorCode(value: unknown): value is GenerateErrorCode {
  return typeof value === "string" && (GENERATE_ERROR_CODES as readonly string[]).includes(value);
}

/** Unknown or missing codes collapse to a generic one rather than leaking through. */
export function toGenerateErrorCode(
  value: unknown,
  fallback: GenerateErrorCode,
): GenerateErrorCode {
  return isGenerateErrorCode(value) ? value : fallback;
}
