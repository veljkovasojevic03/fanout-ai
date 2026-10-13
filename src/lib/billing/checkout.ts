import type { BillingErrorCode } from "./errors";

/*
 * The decisions behind "Upgrade to Pro" and "Manage subscription".
 *
 * Stripe and the database are passed in, so the rules — above all "a guest
 * never reaches Stripe" — are unit-tested without either. Nothing here can
 * change a plan: checkout only sends the user to Stripe, and the plan moves
 * when the signed webhook arrives.
 */

export type BillingUser = {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
};

export type BillingProfile = {
  plan: "guest" | "free" | "pro";
  stripeCustomerId: string | null;
};

export type BillingDeps = {
  getProfile(userId: string): Promise<BillingProfile | null>;
  /** Creates a Stripe customer for the user and returns its id. Must be idempotent per user. */
  createCustomer(user: { id: string; email: string | null }): Promise<string>;
  /** Stores the customer on the profile (set-once) and returns the id that is now linked. */
  linkCustomer(userId: string, customerId: string): Promise<string | null>;
  /** Returns the hosted Checkout URL. */
  createCheckoutSession(input: { userId: string; customerId: string }): Promise<string | null>;
  /** Returns the hosted Customer Portal URL. */
  createPortalSession(input: { customerId: string }): Promise<string | null>;
};

export type BillingResult =
  { ok: true; url: string } | { ok: false; code: Exclude<BillingErrorCode, "network_error"> };

const isGuest = (user: BillingUser, profile: BillingProfile) =>
  user.is_anonymous === true || profile.plan === "guest";

export async function startCheckout(user: BillingUser, deps: BillingDeps): Promise<BillingResult> {
  const profile = await deps.getProfile(user.id);
  if (!profile) return { ok: false, code: "server_error" };

  // First, before anything touches Stripe: a guest has no verified email to
  // bill and no account to attach a subscription to.
  if (isGuest(user, profile)) return { ok: false, code: "guest_not_allowed" };
  if (profile.plan === "pro") return { ok: false, code: "already_subscribed" };

  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const created = await deps.createCustomer({ id: user.id, email: user.email ?? null });
    // Whatever is linked afterwards is the one to use, even if another request won the race.
    customerId = await deps.linkCustomer(user.id, created);
    if (!customerId) return { ok: false, code: "server_error" };
  }

  const url = await deps.createCheckoutSession({ userId: user.id, customerId });
  return url ? { ok: true, url } : { ok: false, code: "server_error" };
}

export async function openPortal(user: BillingUser, deps: BillingDeps): Promise<BillingResult> {
  const profile = await deps.getProfile(user.id);
  if (!profile) return { ok: false, code: "server_error" };

  if (isGuest(user, profile)) return { ok: false, code: "guest_not_allowed" };
  if (!profile.stripeCustomerId) return { ok: false, code: "no_subscription" };

  const url = await deps.createPortalSession({ customerId: profile.stripeCustomerId });
  return url ? { ok: true, url } : { ok: false, code: "server_error" };
}
