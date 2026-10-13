// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import {
  openPortal,
  startCheckout,
  type BillingDeps,
  type BillingProfile,
  type BillingUser,
} from "./checkout";
import { BILLING_ERROR_CODES, BILLING_ERRORS, toBillingErrorCode } from "./errors";
import {
  asUserId,
  planForStatus,
  subscriptionState,
  SUBSCRIPTION_STATUSES,
  type SubscriptionLike,
} from "./plans";
import {
  HANDLED_EVENTS,
  processStripeEvent,
  subscriptionRefOf,
  type ApplyOutcome,
  type ApplyStripeEvent,
  type StripeEventLike,
  type WebhookDeps,
} from "./webhook";

const USER = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const PERIOD_END = 1_800_000_000;

const subscription = (overrides: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: { user_id: USER },
  items: { data: [{ current_period_end: PERIOD_END }] },
  ...overrides,
});

describe("planForStatus", () => {
  it.each([
    ["active", "pro"],
    ["trialing", "pro"],
    ["past_due", "free"],
    ["unpaid", "free"],
    ["canceled", "free"],
    ["incomplete", "free"],
    ["incomplete_expired", "free"],
    ["paused", "free"],
  ] as const)("%s → %s", (status, plan) => {
    expect(planForStatus(status)).toBe(plan);
  });

  it("covers every status Stripe documents", () => {
    const tested = [
      "active",
      "trialing",
      "past_due",
      "unpaid",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "paused",
    ];
    expect([...SUBSCRIPTION_STATUSES].sort()).toEqual(tested.sort());
  });

  it("never grants Pro on a status it does not know, or on nothing", () => {
    expect(planForStatus("some_future_status")).toBe("free");
    expect(planForStatus("ACTIVE")).toBe("free");
    expect(planForStatus("")).toBe("free");
    expect(planForStatus(null)).toBe("free");
    expect(planForStatus(undefined)).toBe("free");
  });
});

describe("subscriptionState", () => {
  it("reads plan, customer, period end and our user id from a subscription", () => {
    expect(subscriptionState(subscription())).toEqual({
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "active",
      plan: "pro",
      periodEnd: new Date(PERIOD_END * 1000),
      cancelAtPeriodEnd: false,
      userId: USER,
    });
  });

  it.each(SUBSCRIPTION_STATUSES)("derives the plan for a %s subscription", (status) => {
    const state = subscriptionState(subscription({ status }));
    expect(state.plan).toBe(status === "active" || status === "trialing" ? "pro" : "free");
    expect(state.status).toBe(status);
  });

  it("accepts an expanded customer object", () => {
    expect(subscriptionState(subscription({ customer: { id: "cus_9" } })).customerId).toBe("cus_9");
    expect(subscriptionState(subscription({ customer: null })).customerId).toBeNull();
  });

  it("takes the period end from the items, the earliest one when there are several", () => {
    const state = subscriptionState(
      subscription({
        items: {
          data: [{ current_period_end: PERIOD_END + 500 }, { current_period_end: PERIOD_END }],
        },
      }),
    );
    expect(state.periodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it("falls back to the subscription-level period end of older API versions", () => {
    const state = subscriptionState(
      subscription({ items: { data: [] }, current_period_end: PERIOD_END }),
    );
    expect(state.periodEnd).toEqual(new Date(PERIOD_END * 1000));
    expect(subscriptionState(subscription({ items: null })).periodEnd).toBeNull();
  });

  it("sees a cancellation at period end, whichever way the portal expressed it", () => {
    expect(subscriptionState(subscription({ cancel_at_period_end: true })).cancelAtPeriodEnd).toBe(
      true,
    );
    expect(subscriptionState(subscription({ cancel_at: PERIOD_END })).cancelAtPeriodEnd).toBe(true);
  });

  it("does not call an ended subscription 'cancelling'", () => {
    const state = subscriptionState(
      subscription({ status: "canceled", cancel_at_period_end: true }),
    );
    expect(state).toMatchObject({ plan: "free", cancelAtPeriodEnd: false });
  });

  it("only trusts a metadata user id that is a UUID", () => {
    expect(asUserId(USER.toUpperCase())).toBe(USER);
    expect(asUserId("1 or 1=1")).toBeNull();
    expect(asUserId(42)).toBeNull();
    expect(subscriptionState(subscription({ metadata: { user_id: "nope" } })).userId).toBeNull();
    expect(subscriptionState(subscription({ metadata: null })).userId).toBeNull();
  });
});

const event = (type: string, object: unknown, id = "evt_1"): StripeEventLike => ({
  id,
  type,
  data: { object },
});

describe("subscriptionRefOf", () => {
  it("finds the subscription of a completed subscription checkout", () => {
    expect(
      subscriptionRefOf(
        event("checkout.session.completed", {
          mode: "subscription",
          subscription: "sub_1",
          client_reference_id: USER,
        }),
      ),
    ).toEqual({ subscriptionId: "sub_1", userId: USER });
  });

  it("ignores a completed checkout that is not a subscription", () => {
    expect(
      subscriptionRefOf(
        event("checkout.session.completed", { mode: "payment", subscription: null }),
      ),
    ).toBeNull();
    expect(
      subscriptionRefOf(
        event("checkout.session.completed", { mode: "subscription", subscription: null }),
      ),
    ).toBeNull();
  });

  it.each([
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
  ])("reads %s", (type) => {
    expect(subscriptionRefOf(event(type, { id: "sub_7", metadata: { user_id: USER } }))).toEqual({
      subscriptionId: "sub_7",
      userId: USER,
    });
    expect(subscriptionRefOf(event(type, { id: "sub_7" }))).toEqual({
      subscriptionId: "sub_7",
      userId: null,
    });
  });

  it("finds the subscription behind a failed invoice, in the new and the old shape", () => {
    expect(
      subscriptionRefOf(
        event("invoice.payment_failed", {
          parent: {
            subscription_details: { subscription: { id: "sub_3" }, metadata: { user_id: USER } },
          },
        }),
      ),
    ).toEqual({ subscriptionId: "sub_3", userId: USER });
    expect(subscriptionRefOf(event("invoice.payment_failed", { subscription: "sub_4" }))).toEqual({
      subscriptionId: "sub_4",
      userId: null,
    });
  });

  it("returns null for a one-off invoice, an unknown event and a malformed payload", () => {
    expect(subscriptionRefOf(event("invoice.payment_failed", { parent: null }))).toBeNull();
    expect(subscriptionRefOf(event("customer.created", { id: "cus_1" }))).toBeNull();
    expect(subscriptionRefOf(event("customer.subscription.updated", null))).toBeNull();
    expect(subscriptionRefOf(event("customer.subscription.updated", { id: 5 }))).toBeNull();
  });
});

/**
 * An in-memory stand-in for `stripe_events` + `apply_stripe_event()`: records
 * the event id and the state it applied, and refuses an id it has seen.
 */
function fakeBackend(current: SubscriptionLike) {
  const seen = new Set<string>();
  const applied: ApplyStripeEvent[] = [];
  const state = { subscription: current };

  const deps: WebhookDeps = {
    alreadyProcessed: vi.fn(async (id: string) => seen.has(id)),
    retrieveSubscription: vi.fn(async () => state.subscription),
    apply: vi.fn(async (input: ApplyStripeEvent): Promise<ApplyOutcome> => {
      if (seen.has(input.eventId)) return "duplicate";
      seen.add(input.eventId);
      applied.push(input);
      return "applied";
    }),
  };
  return { deps, applied, state };
}

const updated = (id = "evt_1") =>
  event("customer.subscription.updated", { id: "sub_1", status: "active", metadata: {} }, id);

describe("processStripeEvent", () => {
  it("applies the subscription's state for every handled event type", async () => {
    const payloads: Record<string, unknown> = {
      "checkout.session.completed": { mode: "subscription", subscription: "sub_1" },
      "customer.subscription.created": { id: "sub_1" },
      "customer.subscription.updated": { id: "sub_1" },
      "customer.subscription.deleted": { id: "sub_1" },
      "invoice.payment_failed": { parent: { subscription_details: { subscription: "sub_1" } } },
    };

    for (const type of HANDLED_EVENTS) {
      const { deps, applied } = fakeBackend(subscription());
      await expect(processStripeEvent(event(type, payloads[type]), deps)).resolves.toBe("applied");
      expect(applied).toEqual([
        {
          eventId: "evt_1",
          eventType: type,
          customerId: "cus_1",
          userId: USER,
          subscriptionId: "sub_1",
          status: "active",
          periodEnd: new Date(PERIOD_END * 1000),
          cancelAtPeriodEnd: false,
        },
      ]);
    }
  });

  it("is idempotent: replaying the same event changes nothing", async () => {
    const { deps, applied } = fakeBackend(subscription());

    await expect(processStripeEvent(updated(), deps)).resolves.toBe("applied");
    await expect(processStripeEvent(updated(), deps)).resolves.toBe("duplicate");
    await expect(processStripeEvent(updated(), deps)).resolves.toBe("duplicate");

    expect(applied).toHaveLength(1);
    // The replay is dropped before Stripe is even asked.
    expect(deps.retrieveSubscription).toHaveBeenCalledTimes(1);
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });

  it("still ends as a duplicate when two deliveries race past the first check", async () => {
    const { deps, applied } = fakeBackend(subscription());
    vi.mocked(deps.alreadyProcessed).mockResolvedValue(false);

    const outcomes = await Promise.all([
      processStripeEvent(updated(), deps),
      processStripeEvent(updated(), deps),
    ]);

    expect(outcomes.sort()).toEqual(["applied", "duplicate"]);
    expect(applied).toHaveLength(1);
  });

  it("applies what the subscription is NOW, not what the event says it was", async () => {
    // A late "created" (status active in its payload) arriving after the cancellation.
    const { deps, applied } = fakeBackend(subscription({ status: "canceled" }));
    const late = event("customer.subscription.created", { id: "sub_1", status: "active" });

    await processStripeEvent(late, deps);

    expect(applied[0]).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });
  });

  it("passes cancel-at-period-end and a failed payment through as they are", async () => {
    const cancelling = fakeBackend(subscription({ cancel_at_period_end: true }));
    await processStripeEvent(updated(), cancelling.deps);
    expect(cancelling.applied[0]).toMatchObject({ status: "active", cancelAtPeriodEnd: true });

    const failed = fakeBackend(subscription({ status: "past_due" }));
    await processStripeEvent(
      event("invoice.payment_failed", {
        parent: { subscription_details: { subscription: "sub_1" } },
      }),
      failed.deps,
    );
    expect(failed.applied[0]).toMatchObject({ status: "past_due" });
  });

  it("uses the user id from the checkout session when the subscription has none", async () => {
    const { deps, applied } = fakeBackend(subscription({ metadata: {} }));
    await processStripeEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        subscription: "sub_1",
        client_reference_id: USER,
      }),
      deps,
    );
    expect(applied[0]?.userId).toBe(USER);
  });

  it("does nothing for events it does not handle or that are not about a subscription", async () => {
    const { deps } = fakeBackend(subscription());

    await expect(processStripeEvent(event("customer.created", {}), deps)).resolves.toBe(
      "unhandled",
    );
    await expect(
      processStripeEvent(event("checkout.session.completed", { mode: "payment" }), deps),
    ).resolves.toBe("irrelevant");

    expect(deps.alreadyProcessed).not.toHaveBeenCalled();
    expect(deps.retrieveSubscription).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("lets failures through, so the route answers 5xx and Stripe retries", async () => {
    const stripeDown = fakeBackend(subscription());
    vi.mocked(stripeDown.deps.retrieveSubscription).mockRejectedValue(new Error("stripe down"));
    await expect(processStripeEvent(updated(), stripeDown.deps)).rejects.toThrow("stripe down");
    expect(stripeDown.applied).toHaveLength(0);

    const dbDown = fakeBackend(subscription());
    vi.mocked(dbDown.deps.apply).mockRejectedValue(new Error("db down"));
    await expect(processStripeEvent(updated(), dbDown.deps)).rejects.toThrow("db down");
  });
});

function billingDeps(profile: BillingProfile | null) {
  const deps: BillingDeps = {
    getProfile: vi.fn(async () => profile),
    createCustomer: vi.fn(async () => "cus_new"),
    linkCustomer: vi.fn(async (_user: string, customer: string) => customer),
    createCheckoutSession: vi.fn(async () => "https://checkout.stripe.com/c/pay/cs_test_1"),
    createPortalSession: vi.fn(async () => "https://billing.stripe.com/p/session/test_1"),
  };
  return deps;
}

const member: BillingUser = { id: USER, email: "a@example.com", is_anonymous: false };
const stripeCalls = (deps: BillingDeps) => [
  deps.createCustomer,
  deps.linkCustomer,
  deps.createCheckoutSession,
  deps.createPortalSession,
];

describe("startCheckout", () => {
  it("blocks an anonymous user before anything reaches Stripe", async () => {
    const deps = billingDeps({ plan: "guest", stripeCustomerId: null });
    const result = await startCheckout({ id: USER, is_anonymous: true }, deps);

    expect(result).toEqual({ ok: false, code: "guest_not_allowed" });
    for (const call of stripeCalls(deps)) expect(call).not.toHaveBeenCalled();
  });

  it("blocks on either signal: the session says guest, or the profile does", async () => {
    // Session not flagged anonymous, but the profile is still on the guest plan.
    const byPlan = billingDeps({ plan: "guest", stripeCustomerId: null });
    await expect(startCheckout(member, byPlan)).resolves.toEqual({
      ok: false,
      code: "guest_not_allowed",
    });
    // Profile somehow 'free', but the session is anonymous.
    const bySession = billingDeps({ plan: "free", stripeCustomerId: null });
    await expect(startCheckout({ id: USER, is_anonymous: true }, bySession)).resolves.toEqual({
      ok: false,
      code: "guest_not_allowed",
    });
    for (const deps of [byPlan, bySession]) {
      for (const call of stripeCalls(deps)) expect(call).not.toHaveBeenCalled();
    }
  });

  it("refuses a second subscription for someone who is already Pro", async () => {
    const deps = billingDeps({ plan: "pro", stripeCustomerId: "cus_1" });
    await expect(startCheckout(member, deps)).resolves.toEqual({
      ok: false,
      code: "already_subscribed",
    });
    expect(deps.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates and links a customer the first time, then opens Checkout for it", async () => {
    const deps = billingDeps({ plan: "free", stripeCustomerId: null });
    const result = await startCheckout(member, deps);

    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    expect(deps.createCustomer).toHaveBeenCalledExactlyOnceWith({
      id: USER,
      email: "a@example.com",
    });
    expect(deps.linkCustomer).toHaveBeenCalledExactlyOnceWith(USER, "cus_new");
    expect(deps.createCheckoutSession).toHaveBeenCalledExactlyOnceWith({
      userId: USER,
      customerId: "cus_new",
    });
  });

  it("uses the customer that ended up linked when another request won the race", async () => {
    const deps = billingDeps({ plan: "free", stripeCustomerId: null });
    vi.mocked(deps.linkCustomer).mockResolvedValue("cus_winner");

    await startCheckout(member, deps);

    expect(deps.createCheckoutSession).toHaveBeenCalledWith({
      userId: USER,
      customerId: "cus_winner",
    });
  });

  it("reuses an existing customer instead of creating another", async () => {
    const deps = billingDeps({ plan: "free", stripeCustomerId: "cus_old" });
    await startCheckout(member, deps);

    expect(deps.createCustomer).not.toHaveBeenCalled();
    expect(deps.createCheckoutSession).toHaveBeenCalledWith({
      userId: USER,
      customerId: "cus_old",
    });
  });

  it("reports a server error when there is no profile, no link or no URL", async () => {
    await expect(startCheckout(member, billingDeps(null))).resolves.toEqual({
      ok: false,
      code: "server_error",
    });

    const unlinked = billingDeps({ plan: "free", stripeCustomerId: null });
    vi.mocked(unlinked.linkCustomer).mockResolvedValue(null);
    await expect(startCheckout(member, unlinked)).resolves.toEqual({
      ok: false,
      code: "server_error",
    });
    expect(unlinked.createCheckoutSession).not.toHaveBeenCalled();

    const noUrl = billingDeps({ plan: "free", stripeCustomerId: "cus_1" });
    vi.mocked(noUrl.createCheckoutSession).mockResolvedValue(null);
    await expect(startCheckout(member, noUrl)).resolves.toEqual({
      ok: false,
      code: "server_error",
    });
  });
});

describe("openPortal", () => {
  it("opens the portal for the user's own customer", async () => {
    const deps = billingDeps({ plan: "pro", stripeCustomerId: "cus_1" });
    await expect(openPortal(member, deps)).resolves.toEqual({
      ok: true,
      url: "https://billing.stripe.com/p/session/test_1",
    });
    expect(deps.createPortalSession).toHaveBeenCalledExactlyOnceWith({ customerId: "cus_1" });
  });

  it("has nothing to open for someone who never subscribed, and blocks guests", async () => {
    const never = billingDeps({ plan: "free", stripeCustomerId: null });
    await expect(openPortal(member, never)).resolves.toEqual({
      ok: false,
      code: "no_subscription",
    });

    const guest = billingDeps({ plan: "guest", stripeCustomerId: null });
    await expect(openPortal({ id: USER, is_anonymous: true }, guest)).resolves.toEqual({
      ok: false,
      code: "guest_not_allowed",
    });
    expect(never.createPortalSession).not.toHaveBeenCalled();
    expect(guest.createPortalSession).not.toHaveBeenCalled();
  });
});

describe("billing error codes", () => {
  it.each([
    ["en", en],
    ["sr", sr],
  ])("%s has a message for every code", (_name, messages) => {
    expect(Object.keys(messages.billing.errors).sort()).toEqual([...BILLING_ERROR_CODES].sort());
  });

  it("gives every server-side code an HTTP status", () => {
    for (const code of BILLING_ERROR_CODES) {
      if (code !== "network_error") expect(BILLING_ERRORS[code].status).toBeGreaterThanOrEqual(400);
    }
    expect(BILLING_ERRORS.guest_not_allowed.status).toBe(403);
  });

  it("collapses unknown codes instead of passing them to the UI", () => {
    expect(toBillingErrorCode("guest_not_allowed")).toBe("guest_not_allowed");
    expect(toBillingErrorCode("<script>")).toBe("server_error");
    expect(toBillingErrorCode(undefined)).toBe("server_error");
  });
});
