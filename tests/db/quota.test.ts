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

type Consumed = { allowed: boolean; remaining: number; plan: string | null };

const consume = (userId: string) =>
  asService(db, async () => {
    const [row] = await db.query<Consumed>("select * from public.consume_generation($1)", [userId]);
    return row!;
  });

const consumeTimes = async (userId: string, times: number) => {
  const results: Consumed[] = [];
  for (let i = 0; i < times; i += 1) results.push(await consume(userId));
  return results;
};

describe("consume_generation (spec §5.2)", () => {
  it("gives a guest exactly 3 generations for life, then returns allowed=false", async () => {
    const guest = await createUser(db, { anonymous: true });
    const results = await consumeTimes(guest, 5);
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0]);
    expect(results.every((r) => r.plan === "guest")).toBe(true);

    const [counter] = await db.query(
      "select period, generations from public.usage_counters where user_id = $1",
      [guest],
    );
    // Rejected calls must not inflate the counter.
    expect(counter).toEqual({ period: "lifetime", generations: 3 });
  });

  it("gives a free user 5 generations in the current UTC month", async () => {
    const user = await createUser(db);
    const results = await consumeTimes(user, 6);
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, true, false]);

    const [counter] = await db.query<{ period: string; generations: number }>(
      "select period, generations from public.usage_counters where user_id = $1",
      [user],
    );
    expect(counter?.period).toMatch(/^\d{4}-\d{2}$/);
    expect(counter?.generations).toBe(5);
  });

  it("gives a pro user 100 generations a month", async () => {
    const user = await createUser(db);
    await db.query("update public.profiles set plan = 'pro' where id = $1", [user]);
    const results = await consumeTimes(user, 101);
    expect(results.filter((r) => r.allowed)).toHaveLength(100);
    expect(results.at(-1)).toEqual({ allowed: false, remaining: 0, plan: "pro" });
  });

  it("starts a fresh monthly allowance: last month's usage does not count", async () => {
    const user = await createUser(db);
    await db.query(
      "insert into public.usage_counters (user_id, period, generations) values ($1, '2020-01', 5)",
      [user],
    );
    expect((await consume(user)).allowed).toBe(true);
  });

  it("gives an upgraded guest the free monthly allowance on top of the spent guest one", async () => {
    const guest = await createUser(db, { anonymous: true });
    await consumeTimes(guest, 3);
    expect((await consume(guest)).allowed).toBe(false);

    await db.query("update auth.users set is_anonymous = false where id = $1", [guest]);
    const next = await consume(guest);
    expect(next).toEqual({ allowed: true, remaining: 4, plan: "free" });
  });

  it("returns allowed=false for an unknown user instead of throwing", async () => {
    const result = await consume("00000000-0000-0000-0000-000000000000");
    expect(result).toEqual({ allowed: false, remaining: 0, plan: null });
  });

  it("cannot be executed by signed-in users or anonymous visitors", async () => {
    const user = await createUser(db);
    await asUser(db, user, () =>
      expectDenied(db, "select * from public.consume_generation($1)", [user]),
    );
    await asAnon(db, () => expectDenied(db, "select * from public.consume_generation($1)", [user]));
  });
});

describe("usage_counters: no client writes", () => {
  it("lets a user read their own counter but not reset, edit or delete it", async () => {
    const user = await createUser(db);
    await consumeTimes(user, 5);

    await asUser(db, user, async () => {
      const rows = await db.query("select generations from public.usage_counters");
      expect(rows).toEqual([{ generations: 5 }]);

      await expectDenied(db, "update public.usage_counters set generations = 0");
      await expectDenied(db, "delete from public.usage_counters");
      await expectDenied(
        db,
        "insert into public.usage_counters (user_id, period, generations) values ($1, '2099-01', 0)",
        [user],
      );
    });

    expect((await consume(user)).allowed).toBe(false);
  });

  it("hides other users' counters", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await consume(bob);
    const rows = await asUser(db, alice, () => db.query("select * from public.usage_counters"));
    expect(rows).toEqual([]);
  });
});

describe("check_rate_limit (spec §5.6)", () => {
  const check = (key: string, windowSeconds: number, max: number) =>
    asService(db, async () => {
      const [row] = await db.query<{ ok: boolean }>(
        "select public.check_rate_limit($1, $2, $3) as ok",
        [key, windowSeconds, max],
      );
      return row!.ok;
    });

  it("allows up to `max` calls per window, then blocks", async () => {
    const results: boolean[] = [];
    // A one-hour window, so the test cannot straddle a window boundary.
    for (let i = 0; i < 5; i += 1) results.push(await check("generate:user-1", 3600, 3));
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("counts each key independently", async () => {
    await check("generate:user-1", 3600, 1);
    expect(await check("generate:user-1", 3600, 1)).toBe(false);
    expect(await check("generate:user-2", 3600, 1)).toBe(true);
  });

  it("rejects nonsensical arguments", async () => {
    await asService(db, async () => {
      await db.query("savepoint bad_args");
      await expect(db.query("select public.check_rate_limit('k', 0, 5)")).rejects.toThrow(
        /invalid arguments/,
      );
      await db.query("rollback to savepoint bad_args");
    });
  });

  it("prunes old windows", async () => {
    await db.query(
      `insert into public.rate_limits (key, window_start, count)
       values ('old', now() - interval '3 days', 9), ('fresh', now(), 1)`,
    );
    const [row] = await asService(db, () =>
      db.query<{ deleted: number }>("select public.prune_rate_limits() as deleted"),
    );
    expect(row?.deleted).toBe(1);
    expect(await db.query("select key from public.rate_limits")).toEqual([{ key: "fresh" }]);
  });

  it("cannot be executed by signed-in users or anonymous visitors", async () => {
    const user = await createUser(db);
    await asUser(db, user, () => expectDenied(db, "select public.check_rate_limit('k', 60, 5)"));
    await asAnon(db, () => expectDenied(db, "select public.check_rate_limit('k', 60, 5)"));
  });
});
