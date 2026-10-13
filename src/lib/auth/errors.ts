/**
 * Stable, UI-facing auth error codes. Supabase's own error strings never reach
 * the user: every failure is mapped to one of these codes, and the code is what
 * gets translated. (Phase 2 moves the English text below into next-intl.)
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

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_input: "Check the highlighted fields and try again.",
  invalid_credentials: "That email and password don't match. Try again or reset your password.",
  email_not_confirmed: "Confirm your email first — check your inbox for the link we sent.",
  email_taken: "An account with this email already exists. Log in instead.",
  weak_password: "Choose a stronger password: at least 8 characters, not a common one.",
  same_password: "Your new password must be different from the current one.",
  captcha_required: "The security check hasn't finished yet. Wait a moment and try again.",
  captcha_failed: "The security check failed. Reload the page and try again.",
  rate_limited: "Too many attempts. Wait a few minutes before trying again.",
  guest_disabled: "Guest mode isn't available right now. Create a free account instead.",
  provider_disabled: "This sign-in method isn't available right now.",
  linking_disabled: "Linking a Google account isn't available right now. Use email instead.",
  identity_taken:
    "That Google account already belongs to another Fanout account. Log in with it instead.",
  link_expired: "This link has expired or was already used. Request a new one.",
  session_missing: "Your session has ended. Log in again to continue.",
  not_configured: "Sign-in isn't set up on this deployment yet.",
  unavailable: "We couldn't reach the server. Check your connection and try again.",
  unknown: "Something went wrong. Try again.",
};

export const FIELD_ERROR_CODES = [
  "email_invalid",
  "password_too_short",
  "password_too_long",
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

export const FIELD_ERROR_MESSAGES: Record<FieldErrorCode, string> = {
  email_invalid: "Enter a valid email address.",
  password_too_short: "Use at least 8 characters.",
  password_too_long: "Use at most 72 characters.",
};

export const AUTH_NOTICES = {
  check_email_signup: "Check your inbox — we sent a link to confirm your email.",
  check_email_reset:
    "If an account exists for that email, a reset link is on its way. It can take a minute.",
  check_email_upgrade:
    "Check your inbox — confirm your email to finish creating your account. Your content stays right here.",
} as const;
export type AuthNotice = keyof typeof AUTH_NOTICES;
