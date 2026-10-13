import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asAnon,
  asService,
  asUser,
  begin,
  createUser,
  expectDenied,
  openDb,
  rollback,
  type Db,
} from "./harness";

let db: Db;

beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => begin(db));
afterEach(() => rollback(db));

type Billing = {
  plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | Date | null;
  cancel_at_period_end: boolean;
};

const billingOf = async (userId: string) =>
  (
    await db.query<Billing>(
      `select plan, stripe_customer_id, stripe_subscription_id, subscription_status,
              current_period_end, cancel_at_period_end
       from public.profiles where id = $1`,
      [userId],
    )
  )[0]!;

type EventInput = {
  id: string;
  type?: string;
  customer?: string;
  user?: string | null;
  subscription?: string;
  status?: string;
  periodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

const apply = (event: EventInput) =>
  asService(db, async () => {
    const [row] = await db.query<{ outcome: string }>(
      "select public.apply_stripe_event($1, $2, $3, $4, $5, $6, $7, $8) as outcome",
      [
        event.id,
        event.type ?? "customer.subscription.updated",
        event.customer ?? "cus_1",
        event.user ?? null,
        event.subscription ?? "sub_1",
        event.status ?? "active",
        event.periodEnd === undefined ? "2027-01-15T00:00:00Z" : event.periodEnd,
        event.cancelAtPeriodEnd ?? false,
      ],
    );
    return row!.outcome;
  });

const link = (userId: string, customer: string) =>
  asService(db, async () => {
    const [row] = await db.query<{ customer: string | null }>(
      "select public.link_stripe_customer($1, $2) as customer",
      [userId, customer],
    );
    return row!.customer;
  });

describe("link_stripe_customer", () => {
  it("links a customer once and keeps the first one", async () => {
    const user = await createUser(db);

    expect(await link(user, "cus_first")).toBe("cus_first");
    // A second request (a race, a retry) gets the customer that is already linked.
    expect(await link(user, "cus_second")).toBe("cus_first");
    expect((await billingOf(user)).stripe_customer_id).toBe("cus_first");
  });

  it("never links a guest", async () => {
    const guest = await createUser(db, { anonymous: true });

    expect(await link(guest, "cus_guest")).toBeNull();
    expect((await billingOf(guest)).stripe_customer_id).toBeNull();
  });

  it("does not change the plan", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");
    expect((await billingOf(user)).plan).toBe("free");
  });
});

describe("apply_stripe_event: plan is derived from the subscription status", () => {
  it.each([
    ["active", "pro"],
    ["trialing", "pro"],
    ["past_due", "free"],
    ["unpaid", "free"],
    ["canceled", "free"],
    ["incomplete", "free"],
    ["incomplete_expired", "free"],
    ["paused", "free"],
    ["some_future_status", "free"],
  ])("%s → %s", async (status, plan) => {
    const user = await createUser(db);
    await link(user, "cus_1");

    expect(await apply({ id: "evt_1", status })).toBe("applied");

    expect(await billingOf(user)).toMatchObject({
      plan,
      subscription_status: status,
      stripe_subscription_id: "sub_1",
    });
  });

  it("walks Free → Pro → cancel at period end → Free", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    await apply({ id: "evt_1", type: "customer.subscription.created", status: "active" });
    expect(await billingOf(user)).toMatchObject({ plan: "pro", cancel_at_period_end: false });

    // Cancelled in the portal: still paid for, still Pro, but flagged.
    await apply({ id: "evt_2", status: "active", cancelAtPeriodEnd: true });
    expect(await billingOf(user)).toMatchObject({ plan: "pro", cancel_at_period_end: true });

    // Changed their mind before the period ended.
    await apply({ id: "evt_3", status: "active", cancelAtPeriodEnd: false });
    expect(await billingOf(user)).toMatchObject({ plan: "pro", cancel_at_period_end: false });

    await apply({ id: "evt_4", type: "customer.subscription.deleted", status: "canceled" });
    expect(await billingOf(user)).toMatchObject({
      plan: "free",
      subscription_status: "canceled",
      cancel_at_period_end: false,
    });
  });

  it("drops Pro when a payment fails and restores it when the payment goes through", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");
    await apply({ id: "evt_1", status: "active" });

    await apply({ id: "evt_2", type: "invoice.payment_failed", status: "past_due" });
    expect(await billingOf(user)).toMatchObject({ plan: "free", subscription_status: "past_due" });

    await apply({ id: "evt_3", status: "active" });
    expect((await billingOf(user)).plan).toBe("pro");
  });

  it("stores the period end, and accepts an event without one", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    await apply({ id: "evt_1", periodEnd: "2027-03-01T12:00:00Z" });
    expect(new Date((await billingOf(user)).current_period_end!).toISOString()).toBe(
      "2027-03-01T12:00:00.000Z",
    );

    await apply({ id: "evt_2", periodEnd: null });
    expect((await billingOf(user)).current_period_end).toBeNull();
  });

  it("never flags an inactive subscription as cancelling", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    await apply({ id: "evt_1", status: "canceled", cancelAtPeriodEnd: true });
    expect((await billingOf(user)).cancel_at_period_end).toBe(false);
  });
});

describe("apply_stripe_event: idempotency", () => {
  it("applies an event id once; a replay changes nothing", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    expect(await apply({ id: "evt_1", status: "active" })).toBe("applied");
    await apply({ id: "evt_2", status: "canceled" });
    const before = await billingOf(user);

    // Stripe re-delivers the first event (the one that said "active").
    expect(await apply({ id: "evt_1", status: "active" })).toBe("duplicate");

    expect(await billingOf(user)).toEqual(before);
    expect(before.plan).toBe("free");
    const events = await db.query("select id from public.stripe_events order by id");
    expect(events).toEqual([{ id: "evt_1" }, { id: "evt_2" }]);
  });

  it("records the event and the profile change together, or neither", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    // A missing status makes the function raise, after nothing has been written.
    await db.query("savepoint bad_event");
    await expect(
      asService(db, () =>
        db.query(
          "select public.apply_stripe_event('evt_bad', 't', 'cus_1', null, 'sub_1', null, null, false)",
        ),
      ),
    ).rejects.toThrow();
    await db.query("rollback to savepoint bad_event");

    expect(await db.query("select id from public.stripe_events")).toEqual([]);
    expect((await billingOf(user)).plan).toBe("free");
    // So the retry of the same event id is a clean first attempt.
    expect(await apply({ id: "evt_bad", status: "active" })).toBe("applied");
  });
});

describe("apply_stripe_event: which user", () => {
  it("links the customer from our own user id when it is not linked yet", async () => {
    const user = await createUser(db);

    expect(await apply({ id: "evt_1", customer: "cus_new", user })).toBe("applied");

    expect(await billingOf(user)).toMatchObject({ plan: "pro", stripe_customer_id: "cus_new" });
  });

  it("prefers the profile already linked to the customer over the user id in the event", async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    await link(owner, "cus_1");

    await apply({ id: "evt_1", customer: "cus_1", user: other });

    expect((await billingOf(owner)).plan).toBe("pro");
    expect(await billingOf(other)).toMatchObject({ plan: "free", stripe_customer_id: null });
  });

  it("does not re-point a user who already has a different customer", async () => {
    const user = await createUser(db);
    await link(user, "cus_mine");

    expect(await apply({ id: "evt_1", customer: "cus_other", user })).toBe("no_user");

    expect(await billingOf(user)).toMatchObject({ plan: "free", stripe_customer_id: "cus_mine" });
  });

  it("reports an event for a customer nobody owns, and still records it", async () => {
    expect(await apply({ id: "evt_1", customer: "cus_unknown" })).toBe("no_user");
    expect(await apply({ id: "evt_1", customer: "cus_unknown" })).toBe("duplicate");
  });

  it("never upgrades a guest", async () => {
    const guest = await createUser(db, { anonymous: true });

    expect(await apply({ id: "evt_1", customer: "cus_g", user: guest })).toBe("no_user");
    expect(await billingOf(guest)).toMatchObject({ plan: "guest", stripe_customer_id: null });
  });

  it("only touches the one profile", async () => {
    const subscriber = await createUser(db);
    const bystander = await createUser(db);
    await link(subscriber, "cus_1");
    await link(bystander, "cus_2");

    await apply({ id: "evt_1", customer: "cus_1" });

    expect((await billingOf(subscriber)).plan).toBe("pro");
    expect(await billingOf(bystander)).toMatchObject({ plan: "free", subscription_status: null });
  });
});

describe("apply_stripe_event: several subscriptions", () => {
  it("ignores the late end of an old subscription after a new one has started", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");
    await apply({ id: "evt_1", subscription: "sub_old", status: "active" });
    await apply({ id: "evt_2", subscription: "sub_new", status: "active" });

    expect(await apply({ id: "evt_3", subscription: "sub_old", status: "canceled" })).toBe(
      "ignored",
    );

    expect(await billingOf(user)).toMatchObject({
      plan: "pro",
      stripe_subscription_id: "sub_new",
      subscription_status: "active",
    });
  });

  it("lets a new active subscription replace an ended one", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");
    await apply({ id: "evt_1", subscription: "sub_old", status: "canceled" });

    expect(await apply({ id: "evt_2", subscription: "sub_new", status: "active" })).toBe("applied");
    expect(await billingOf(user)).toMatchObject({ plan: "pro", stripe_subscription_id: "sub_new" });
  });
});

describe("billing cannot be reached from the client", () => {
  const event =
    "select public.apply_stripe_event('evt_x', 't', 'cus_x', $1, 'sub_x', 'active', null, false)";

  it("refuses apply_stripe_event and link_stripe_customer to signed-in users and visitors", async () => {
    const user = await createUser(db);

    await asUser(db, user, async () => {
      await expectDenied(db, event, [user]);
      await expectDenied(db, "select public.link_stripe_customer($1, 'cus_x')", [user]);
    });
    await asAnon(db, async () => {
      await expectDenied(db, event, [user]);
      await expectDenied(db, "select public.link_stripe_customer($1, 'cus_x')", [user]);
    });
    expect((await billingOf(user)).plan).toBe("free");
  });

  it("refuses a user's own UPDATE of every billing column, including the new one", async () => {
    const user = await createUser(db);

    await asUser(db, user, async () => {
      for (const assignment of [
        "plan = 'pro'",
        "stripe_customer_id = 'cus_x'",
        "stripe_subscription_id = 'sub_x'",
        "subscription_status = 'active'",
        "current_period_end = now() + interval '10 years'",
        "cancel_at_period_end = true",
      ]) {
        await expectDenied(db, `update public.profiles set ${assignment} where id = $1`, [user]);
      }
    });
  });

  it("keeps stripe_events invisible to users", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");
    await apply({ id: "evt_1" });

    await asUser(db, user, () => expectDenied(db, "select * from public.stripe_events"));
    await asUser(db, user, () =>
      expectDenied(db, "insert into public.stripe_events (id, type) values ('evt_fake', 't')"),
    );
  });

  it("lets a user read their own billing state, and nobody else's", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await link(alice, "cus_a");
    await link(bob, "cus_b");
    await apply({ id: "evt_1", customer: "cus_b", cancelAtPeriodEnd: true });

    const rows = await asUser(db, alice, () =>
      db.query("select plan, stripe_customer_id, cancel_at_period_end from public.profiles"),
    );
    expect(rows).toEqual([
      { plan: "free", stripe_customer_id: "cus_a", cancel_at_period_end: false },
    ]);
  });

  it("gives a subscriber the Pro quota and lengths straight away", async () => {
    const user = await createUser(db);
    await link(user, "cus_1");

    const start = () =>
      asService(db, async () => {
        const [row] = await db.query<{ status: string; remaining: number; model: string | null }>(
          `select * from public.start_generation(
             $1, 'Topic', 'casual', 'long', 'en', '{}', 'none', null, null,
             array['blog'], true, 30, 'model-free', 'model-pro')`,
          [user],
        );
        return row!;
      });

    expect((await start()).status).toBe("length_not_allowed");

    await apply({ id: "evt_1", status: "active" });
    expect(await start()).toMatchObject({ status: "ok", remaining: 99, model: "model-pro" });

    await apply({ id: "evt_2", status: "canceled" });
    expect((await start()).status).toBe("length_not_allowed");
  });
});
