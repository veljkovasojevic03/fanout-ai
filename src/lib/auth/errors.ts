/**
 * Stable, UI-facing auth error codes. Supabase's own error strings never reach
 * the user: every failure is mapped to one of these codes, and the code is what
 * gets translated (messages/*.json → auth.errors).
 */
export const AUTH_ERROR_CODES = [
  "invalid_input",
  "invalid_credentials",
  "email_not_confirmed",
  "email_taken",
  "weak_password",
  "same_password",
  "captcha_required",
  "captcha_failed",
  "rate_limited",
  "guest_disabled",
  "provider_disabled",
  "linking_disabled",
  "identity_taken",
  "link_expired",
  "session_missing",
  "not_configured",
  "unavailable",
  "unknown",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

const SUPABASE_CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  provider_email_needs_verification: "email_not_confirmed",
  user_already_exists: "email_taken",
  email_exists: "email_taken",
  weak_password: "weak_password",
  same_password: "same_password",
  captcha_failed: "captcha_failed",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  anonymous_provider_disabled: "guest_disabled",
  provider_disabled: "provider_disabled",
  email_provider_disabled: "provider_disabled",
  oauth_provider_not_supported: "provider_disabled",
  signup_disabled: "provider_disabled",
  manual_linking_disabled: "linking_disabled",
  identity_already_exists: "identity_taken",
  otp_expired: "link_expired",
  flow_state_expired: "link_expired",
  flow_state_not_found: "link_expired",
  bad_code_verifier: "link_expired",
  bad_oauth_state: "link_expired",
  bad_oauth_callback: "link_expired",
  session_not_found: "session_missing",
  session_expired: "session_missing",
  refresh_token_not_found: "session_missing",
  no_authorization: "session_missing",
  validation_failed: "invalid_input",
  email_address_invalid: "invalid_input",
  request_timeout: "unavailable",
  unexpected_failure: "unavailable",
};

type AuthErrorLike = { code?: string | null; status?: number | null; name?: string | null };

/** Maps a Supabase auth error (or an error_code query param) to a UI error code. */
export function mapAuthError(error: AuthErrorLike | null | undefined): AuthErrorCode {
  if (!error) return "unknown";
  if (error.code && SUPABASE_CODE_MAP[error.code]) return SUPABASE_CODE_MAP[error.code]!;
  if (error.status === 429) return "rate_limited";
  // Network failures and 5xx: the project is unreachable or paused.
  if (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500) return "unavailable";
  return "unknown";
}

// The text for every code lives in messages/*.json (auth.errors, auth.fieldErrors,
// auth.notices). The type-checked message keys make a missing translation a
// compile error, and a unit test checks the catalogue against these lists.

export const FIELD_ERROR_CODES = [
  "email_invalid",
  "password_too_short",
  "password_too_long",
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

export const AUTH_NOTICES = [
  "check_email_signup",
  "check_email_reset",
  "check_email_upgrade",
] as const;
export type AuthNotice = (typeof AUTH_NOTICES)[number];
