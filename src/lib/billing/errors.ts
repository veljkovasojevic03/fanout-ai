/**
 * Every error code the billing UI can show. Each has a translation under
 * `billing.errors` in both languages (enforced by a unit test).
 */
export const BILLING_ERROR_CODES = [
  "unauthenticated",
  // Guests must create an account before they can subscribe (spec §4.1).
  "guest_not_allowed",
  "already_subscribed",
  // The portal only exists for someone who has been through checkout.
  "no_subscription",
  "not_configured",
  "rate_limited",
  "server_error",
  // client-side only
  "network_error",
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];

export function toBillingErrorCode(value: unknown): BillingErrorCode {
  return typeof value === "string" && (BILLING_ERROR_CODES as readonly string[]).includes(value)
    ? (value as BillingErrorCode)
    : "server_error";
}

/** HTTP status and an English fallback message per code (the UI translates the code). */
export const BILLING_ERRORS: Record<
  Exclude<BillingErrorCode, "network_error">,
  { status: number; message: string }
> = {
  unauthenticated: { status: 401, message: "Sign in to continue." },
  guest_not_allowed: { status: 403, message: "Create an account before subscribing." },
  already_subscribed: { status: 409, message: "This account already has an active subscription." },
  no_subscription: { status: 409, message: "This account has no subscription to manage." },
  not_configured: { status: 503, message: "Billing is not set up on this deployment." },
  rate_limited: { status: 429, message: "Too many requests. Try again shortly." },
  server_error: { status: 500, message: "Something went wrong on the server." },
};
