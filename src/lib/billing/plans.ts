import type { Length } from "@/lib/presets";

/*
 * The plan model that is safe to import anywhere (no secrets, no I/O).
 *
 * Limits themselves live in the `plan_limits` table; PLAN_DEFAULTS mirrors its
 * seed and is only used where the table cannot be read (the public pricing
 * section, the design preview). The plan a user is on is never decided here:
 * `apply_stripe_event()` derives it in the database from the subscription
 * status. `planForStatus` is the same rule, for the UI and for tests.
 */

export const PAID_PLANS = ["free", "pro"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export type PlanSummary = { generations: number; maxLength: Length };

export const PLAN_DEFAULTS: Record<PaidPlan, PlanSummary> = {
  free: { generations: 5, maxLength: "medium" },
  pro: { generations: 100, maxLength: "long" },
};

/** Pro costs $12 a month — in Stripe test mode, so nobody is ever charged (spec §4.6). */
export const PRO_PRICE = { amount: 12, currency: "USD", interval: "month" } as const;

/** Every status a Stripe subscription can have. */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * active | trialing → pro; everything else → free (spec §5.10). An unknown
 * status — one Stripe adds later — is not Pro either: access is only ever
 * granted on a status we know means "paid".
 */
export function planForStatus(status: string | null | undefined): PaidPlan {
  return status === "active" || status === "trialing" ? "pro" : "free";
}

/** The parts of a Stripe subscription object this app reads. */
export type SubscriptionLike = {
  id: string;
  status: string;
  customer: string | { id: string } | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: readonly { current_period_end?: number | null }[] } | null;
  /** Older API versions carried the period on the subscription itself. */
  current_period_end?: number | null;
};

export type SubscriptionState = {
  subscriptionId: string;
  customerId: string | null;
  status: string;
  plan: PaidPlan;
  /** When the paid period ends (renewal or cancellation date), if known. */
  periodEnd: Date | null;
  /** True when the subscription is set to end instead of renewing. */
  cancelAtPeriodEnd: boolean;
  /** Our user id, as stored in the subscription's metadata at checkout. */
  userId: string | null;
};

export const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A user id from Stripe metadata is only used if it actually looks like one. */
export const asUserId = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;

/** Everything `apply_stripe_event()` needs, read from one subscription object. */
export function subscriptionState(subscription: SubscriptionLike): SubscriptionState {
  const itemEnds = (subscription.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((end): end is number => typeof end === "number");
  // With several items the earliest end is when access first lapses.
  const periodEnd =
    itemEnds.length > 0 ? Math.min(...itemEnds) : (subscription.current_period_end ?? null);

  const plan = planForStatus(subscription.status);

  return {
    subscriptionId: subscription.id,
    customerId: idOf(subscription.customer),
    status: subscription.status,
    plan,
    periodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
    // The portal cancels either with the flag or with an explicit end date.
    cancelAtPeriodEnd:
      plan === "pro" &&
      (subscription.cancel_at_period_end === true || typeof subscription.cancel_at === "number"),
    userId: asUserId(subscription.metadata?.user_id),
  };
}
