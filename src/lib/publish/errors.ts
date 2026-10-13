/**
 * Every error code the publishing UI can show after an action. Each has a
 * translation under `publish.errors` in both languages (enforced by a unit test).
 */
export const PUBLISH_ERROR_CODES = [
  "unauthenticated",
  // Guests cannot publish (spec §4.1).
  "guest_not_allowed",
  "invalid_input",
  "invalid_time",
  "invalid_webhook_url",
  "rate_limited",
  "content_not_found",
  "destination_not_found",
  "job_not_found",
  // Email goes to the account's own address, and only once it is verified.
  "email_unverified",
  "too_many_jobs",
  "too_many_destinations",
  "too_many_attempts",
  // The job has moved on (sent, cancelled…) since the page was loaded.
  "not_scheduled",
  "not_failed",
  "test_failed",
  "not_configured",
  "server_error",
  // client-side only
  "network_error",
] as const;

export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number];

/**
 * Why a delivery attempt failed. Stored in `publish_jobs.last_error` and
 * `publish_attempts.detail` as `<code>` or `<code>:<http status>`; translated
 * under `publish.failures`.
 */
export const DELIVERY_ERROR_CODES = [
  // The destination (SMTP server, Discord) refused or errored.
  "delivery_failed",
  // n8n could not be reached, or answered with an error.
  "n8n_unreachable",
  "n8n_rejected",
  // No answer within ten minutes (set by the cron tick).
  "timeout",
  "email_unverified",
  "content_empty",
  "content_too_long",
  // Something went wrong on our side before the message left.
  "dispatch_error",
] as const;

export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

/** What n8n may report in its callback. Anything else is read as `delivery_failed`. */
export const CALLBACK_ERROR_CODES = ["delivery_failed"] as const satisfies DeliveryErrorCode[];

export type DeliveryFailure = { code: DeliveryErrorCode; httpStatus: number | null };

/** `delivery_failed` + 429 → `delivery_failed:429` (the shape the database accepts). */
export function formatFailure(code: DeliveryErrorCode, httpStatus?: number | null): string {
  return httpStatus && httpStatus >= 100 && httpStatus <= 599 ? `${code}:${httpStatus}` : code;
}

/** Reads a stored failure back. Unknown codes (from a newer version) become `delivery_failed`. */
export function parseFailure(value: string | null | undefined): DeliveryFailure | null {
  if (!value) return null;
  const [rawCode, rawStatus] = value.split(":");
  const code = (DELIVERY_ERROR_CODES as readonly string[]).includes(rawCode ?? "")
    ? (rawCode as DeliveryErrorCode)
    : "delivery_failed";
  const httpStatus = rawStatus && /^\d{3}$/.test(rawStatus) ? Number(rawStatus) : null;
  return { code, httpStatus };
}
