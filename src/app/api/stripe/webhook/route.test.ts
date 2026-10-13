// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStripe } from "@/lib/billing/stripe";

import { POST } from "./route";

/*
 * The webhook route with REAL signature verification: payloads are signed with
 * Stripe's own test helper, and only the two outside systems are faked — the
 * database (stripe_events + apply_stripe_event) and Stripe's API.
 */

const db = vi.hoisted(() => ({
  events: new Set<string>(),
  applied: [] as Record<string, unknown>[],
  rpcError: null as { code: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: db.events.has(id) ? { id } : null, error: null }),
        }),
      }),
    }),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (db.rpcError) return { data: null, error: db.rpcError };
      const id = String(args.p_event_id);
      if (db.events.has(id)) return { data: "duplicate", error: null };
      db.events.add(id);
      db.applied.push(args);
      return { data: "applied", error: null };
    },
  }),
}));

const SECRET = "whsec_test_secret";
const USER = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const PERIOD_END = 1_800_000_000;

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_1",
  object: "subscription",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: { user_id: USER },
  items: { data: [{ current_period_end: PERIOD_END }] },
  ...overrides,
});

const eventBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.subscription.updated",
    livemode: false,
    data: { object: subscription() },
    ...overrides,
  });

const stripe = () => getStripe()!;

const sign = (payload: string, secret = SECRET) =>
  stripe().webhooks.generateTestHeaderString({ payload, secret });

const post = (payload: string, signature?: string) =>
  POST(
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: signature ? { "stripe-signature": signature } : {},
      body: payload,
    }),
  );

let retrieve: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  db.events.clear();
  db.applied.length = 0;
  db.rpcError = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  retrieve = vi
    .spyOn(stripe().subscriptions, "retrieve")
    .mockResolvedValue(subscription() as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/stripe/webhook", () => {
  it("applies a correctly signed event", async () => {
    const payload = eventBody();
    const response = await post(payload, sign(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "applied" });
    expect(db.applied).toEqual([
      {
        p_event_id: "evt_1",
        p_event_type: "customer.subscription.updated",
        p_customer: "cus_1",
        p_user: USER,
        p_subscription: "sub_1",
        p_status: "active",
        p_period_end: new Date(PERIOD_END * 1000).toISOString(),
        p_cancel_at_period_end: false,
      },
    ]);
  });

  it("rejects a request without a signature and touches nothing", async () => {
    const response = await post(eventBody());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_signature" } });
    expect(retrieve).not.toHaveBeenCalled();
    expect(db.applied).toHaveLength(0);
    expect(db.events.size).toBe(0);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const payload = eventBody();
    const response = await post(payload, sign(payload, "whsec_someone_else"));

    expect(response.status).toBe(400);
    expect(db.applied).toHaveLength(0);
  });

  it("rejects a body that was changed after it was signed", async () => {
    // A valid signature for a harmless event, replayed over a forged "you are Pro" body.
    const signature = sign(eventBody({ type: "customer.created" }));
    const response = await post(eventBody(), signature);

    expect(response.status).toBe(400);
    expect(db.applied).toHaveLength(0);
  });

  it("rejects a signature that is too old to be a fresh delivery", async () => {
    const payload = eventBody();
    const stale = stripe().webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    expect((await post(payload, stale)).status).toBe(400);
    expect(db.applied).toHaveLength(0);
  });

  it("is idempotent: the same event delivered again changes nothing", async () => {
    const payload = eventBody();

    const first = await post(payload, sign(payload));
    const second = await post(payload, sign(payload));

    await expect(first.json()).resolves.toMatchObject({ outcome: "applied" });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ outcome: "duplicate" });
    expect(db.applied).toHaveLength(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it("derives the state from Stripe, not from what the payload claims", async () => {
    // The payload says "active", but the subscription has in fact been cancelled.
    retrieve.mockResolvedValue(subscription({ status: "canceled" }) as never);
    const payload = eventBody();

    await post(payload, sign(payload));

    expect(db.applied[0]).toMatchObject({ p_status: "canceled", p_cancel_at_period_end: false });
  });

  it("acknowledges events it does not handle without doing anything", async () => {
    const payload = eventBody({ type: "customer.created", data: { object: { id: "cus_1" } } });
    const response = await post(payload, sign(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "unhandled" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(db.applied).toHaveLength(0);
  });

  it("never applies a live-mode event", async () => {
    const payload = eventBody({ livemode: true });
    const response = await post(payload, sign(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "ignored" });
    expect(db.applied).toHaveLength(0);
  });

  it("answers 500 when the database fails, so Stripe retries, and leaks no detail", async () => {
    db.rpcError = { code: "57014" };
    const payload = eventBody();
    const response = await post(payload, sign(payload));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("server_error");
    expect(body).not.toContain("57014");
    expect(db.events.size).toBe(0);
  });

  it("answers 500 when Stripe cannot be reached", async () => {
    retrieve.mockRejectedValue(new Error("connection reset"));
    const payload = eventBody();
    const response = await post(payload, sign(payload));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("connection reset");
  });

  it("is switched off without a webhook secret or with a live key", async () => {
    const payload = eventBody();
    const signature = sign(payload);

    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect((await post(payload, signature)).status).toBe(503);

    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never");
    expect((await post(payload, signature)).status).toBe(503);
    expect(db.applied).toHaveLength(0);
  });
});
