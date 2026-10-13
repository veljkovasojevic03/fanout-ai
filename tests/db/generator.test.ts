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

type Started = {
  status: string;
  generation_id: string | null;
  mode: string | null;
  model: string | null;
  plan: string | null;
  remaining: number;
};

type StartOptions = {
  length?: string;
  types?: string[];
  wantLive?: boolean;
  dailyCap?: number;
};

const start = (userId: string, options: StartOptions = {}) =>
  asService(db, async () => {
    const [row] = await db.query<Started>(
      `select * from public.start_generation(
         $1, 'Topic', 'casual', $2, 'en', array['a', 'b'],
         'none', null, null, $3::text[], $4, $5, 'model-free', 'model-pro')`,
      [
        userId,
        options.length ?? "short",
        options.types ?? ["blog", "linkedin"],
        options.wantLive ?? false,
        options.dailyCap ?? 30,
      ],
    );
    return row!;
  });

type Claimed = {
  status: string;
  generation: { id: string; topic: string; mode: string } | null;
  attempt: number;
  regenerations_left: number;
};

const claim = (generationId: string, userId: string, type: string, regenerate = false, max = 10) =>
  asService(db, async () => {
    const [row] = await db.query<Claimed>(
      "select * from public.claim_generation_stream($1, $2, $3, $4, $5)",
      [generationId, userId, type, regenerate, max],
    );
    return row!;
  });

const finish = (generationId: string, type: string, input: number, output: number, words: number) =>
  asService(db, () =>
    db.query("select public.finish_generation_stream($1, $2, $3, $4, $5)", [
      generationId,
      type,
      input,
      output,
      words,
    ]),
  );

const usedGenerations = async (userId: string) =>
  (
    await db.query<{ generations: number }>(
      "select coalesce(sum(generations), 0)::int as generations from public.usage_counters where user_id = $1",
      [userId],
    )
  )[0]!.generations;

describe("start_generation", () => {
  it("consumes one generation and creates a sample generation by default", async () => {
    const user = await createUser(db);
    const result = await start(user);

    expect(result).toMatchObject({
      status: "ok",
      mode: "sample",
      model: null,
      plan: "free",
      remaining: 4,
    });
    const [row] = await db.query(
      "select user_id, topic, keywords, types, mode, status from public.generations where id = $1",
      [result.generation_id],
    );
    expect(row).toEqual({
      user_id: user,
      topic: "Topic",
      keywords: ["a", "b"],
      types: ["blog", "linkedin"],
      mode: "sample",
      status: "pending",
    });
  });

  it("rejects a guest's 4th generation without creating a row", async () => {
    const guest = await createUser(db, { anonymous: true });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await start(guest)).status);

    expect(statuses).toEqual(["ok", "ok", "ok", "quota_exhausted"]);
    const rows = await db.query("select id from public.generations where user_id = $1", [guest]);
    expect(rows).toHaveLength(3);
  });

  it("rejects a length the plan does not include, without spending quota", async () => {
    const user = await createUser(db);
    const result = await start(user, { length: "long" });

    expect(result).toMatchObject({ status: "length_not_allowed", plan: "free" });
    expect(await usedGenerations(user)).toBe(0);
  });

  it("lets a pro user generate at Long length", async () => {
    const user = await createUser(db);
    await db.query("update public.profiles set plan = 'pro' where id = $1", [user]);
    expect((await start(user, { length: "long" })).status).toBe("ok");
  });

  it("rejects an unknown length instead of treating it as allowed", async () => {
    const user = await createUser(db);
    expect((await start(user, { length: "epic" })).status).toBe("length_not_allowed");
  });

  it("picks the model by plan when a live slot is available", async () => {
    const free = await createUser(db);
    const pro = await createUser(db);
    await db.query("update public.profiles set plan = 'pro' where id = $1", [pro]);

    expect(await start(free, { wantLive: true })).toMatchObject({
      mode: "live",
      model: "model-free",
    });
    expect(await start(pro, { wantLive: true })).toMatchObject({
      mode: "live",
      model: "model-pro",
    });
  });

  it("falls back to sample once the global daily cap is reached (spec §5.3)", async () => {
    const pro = await createUser(db);
    await db.query("update public.profiles set plan = 'pro' where id = $1", [pro]);

    const modes = [];
    for (let i = 0; i < 4; i += 1)
      modes.push((await start(pro, { wantLive: true, dailyCap: 2 })).mode);

    expect(modes).toEqual(["live", "live", "sample", "sample"]);
    const [counter] = await db.query("select real_generations from public.app_counters");
    // The counter stops at the cap; sample fallbacks do not inflate it.
    expect(counter).toEqual({ real_generations: 2 });
  });

  it("never goes live with a zero cap or when live was not requested", async () => {
    const user = await createUser(db);
    expect((await start(user, { wantLive: true, dailyCap: 0 })).mode).toBe("sample");
    expect((await start(user, { wantLive: false })).mode).toBe("sample");
    expect(await db.query("select * from public.app_counters")).toEqual([]);
  });

  it("returns no_profile for an unknown user", async () => {
    const result = await start("00000000-0000-0000-0000-000000000000");
    expect(result.status).toBe("no_profile");
  });

  it("rolls the quota back if the generation row cannot be inserted", async () => {
    const user = await createUser(db);
    await asService(db, async () => {
      await db.query("savepoint bad_insert");
      // An unknown type violates the CHECK constraint on generations.types.
      await expect(
        db.query(
          `select * from public.start_generation(
             $1, 'Topic', 'casual', 'short', 'en', '{}', 'none', null, null,
             array['podcast'], false, 30, 'f', 'p')`,
          [user],
        ),
      ).rejects.toThrow();
      await db.query("rollback to savepoint bad_insert");
    });
    expect(await usedGenerations(user)).toBe(0);
  });
});

describe("claim_generation_stream", () => {
  it("allows each selected type to stream exactly once", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);

    const first = await claim(id!, user, "blog");
    expect(first).toMatchObject({ status: "ok", attempt: 1, regenerations_left: 10 });
    expect(first.generation).toMatchObject({ id, topic: "Topic", mode: "sample" });

    expect((await claim(id!, user, "blog")).status).toBe("already_streamed");
    // A different selected type is independent.
    expect((await claim(id!, user, "linkedin")).status).toBe("ok");
  });

  it("refuses a type that was not selected for this generation", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user, { types: ["blog"] });
    expect((await claim(id!, user, "x_thread")).status).toBe("type_not_selected");
  });

  it("treats another user's generation as not found", async () => {
    const alice = await createUser(db);
    const mallory = await createUser(db);
    const { generation_id: id } = await start(alice);

    expect((await claim(id!, mallory, "blog")).status).toBe("not_found");
    expect((await claim(id!, mallory, "blog", true)).status).toBe("not_found");
    // And Mallory's attempt must not have used up Alice's one stream.
    expect((await claim(id!, alice, "blog")).status).toBe("ok");
  });

  it("only regenerates a type that has streamed before", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);
    expect((await claim(id!, user, "blog", true)).status).toBe("not_started");
  });

  it("caps regenerations per generation and counts them across types", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);
    await claim(id!, user, "blog");
    await claim(id!, user, "linkedin");

    const results = [
      await claim(id!, user, "blog", true, 3),
      await claim(id!, user, "linkedin", true, 3),
      await claim(id!, user, "blog", true, 3),
      await claim(id!, user, "blog", true, 3),
    ];

    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "cap_reached"]);
    expect(results.map((r) => r.regenerations_left)).toEqual([2, 1, 0, 0]);
    expect(results.map((r) => r.attempt)).toEqual([2, 2, 3, 0]);

    const [row] = await db.query("select refinements_used from public.generations where id = $1", [
      id,
    ]);
    expect(row).toEqual({ refinements_used: 3 });
  });

  it("does not let a regeneration consume another monthly generation", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);
    await claim(id!, user, "blog");
    await claim(id!, user, "blog", true);
    expect(await usedGenerations(user)).toBe(1);
  });
});

describe("finish_generation_stream", () => {
  it("accumulates tokens and words, and completes the generation when every type is done", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);
    await claim(id!, user, "blog");
    await claim(id!, user, "linkedin");

    await finish(id!, "blog", 300, 900, 410);
    const [partial] = await db.query(
      "select status, input_tokens, output_tokens from public.generations where id = $1",
      [id],
    );
    expect(partial).toEqual({ status: "pending", input_tokens: 300, output_tokens: 900 });

    await finish(id!, "linkedin", 250, 200, 180);
    const [done] = await db.query(
      "select status, input_tokens, output_tokens from public.generations where id = $1",
      [id],
    );
    expect(done).toEqual({ status: "completed", input_tokens: 550, output_tokens: 1100 });

    const [counter] = await db.query(
      "select generations, words from public.usage_counters where user_id = $1",
      [user],
    );
    expect(counter).toEqual({ generations: 1, words: 590 });
  });

  it("counts a guest's words against the lifetime counter", async () => {
    const guest = await createUser(db, { anonymous: true });
    const { generation_id: id } = await start(guest, { types: ["instagram"] });
    await claim(id!, guest, "instagram");
    await finish(id!, "instagram", 0, 0, 80);

    const [counter] = await db.query(
      "select period, words from public.usage_counters where user_id = $1",
      [guest],
    );
    expect(counter).toEqual({ period: "lifetime", words: 80 });
  });

  it("ignores a stream that was never claimed and clamps negative numbers", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);
    await finish(id!, "blog", 100, 100, 100);
    await claim(id!, user, "linkedin");
    await finish(id!, "linkedin", -5, -5, -5);

    const [row] = await db.query(
      "select input_tokens, output_tokens from public.generations where id = $1",
      [id],
    );
    expect(row).toEqual({ input_tokens: 0, output_tokens: 0 });
    const [counter] = await db.query("select words from public.usage_counters where user_id = $1", [
      user,
    ]);
    expect(counter).toEqual({ words: 0 });
  });
});

describe("generator functions and tables are server-only", () => {
  it("cannot be executed by signed-in users or anonymous visitors", async () => {
    const user = await createUser(db);
    const { generation_id: id } = await start(user);

    const calls: [string, unknown[]][] = [
      [
        `select * from public.start_generation($1, 'T', 'casual', 'short', 'en', '{}', 'none',
           null, null, array['blog'], true, 1000000, 'f', 'p')`,
        [user],
      ],
      ["select * from public.claim_generation_stream($1, $2, 'blog', false, 1000000)", [id, user]],
      ["select public.finish_generation_stream($1, 'blog', 0, 0, 0)", [id]],
    ];

    for (const [sql, params] of calls) {
      await asUser(db, user, () => expectDenied(db, sql, params));
      await asAnon(db, () => expectDenied(db, sql, params));
    }
  });

  it("lets a user read their own stream rows but not write them or see others'", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const mine = await start(alice);
    const theirs = await start(bob);
    await claim(mine.generation_id!, alice, "blog");
    await claim(theirs.generation_id!, bob, "blog");

    await asUser(db, alice, async () => {
      expect(await db.query("select generation_id from public.generation_streams")).toEqual([
        { generation_id: mine.generation_id },
      ]);
      await expectDenied(db, "delete from public.generation_streams");
      await expectDenied(
        db,
        "insert into public.generation_streams (generation_id, type) values ($1, 'email')",
        [mine.generation_id],
      );
    });
    await asAnon(db, () => expectDenied(db, "select * from public.generation_streams"));
  });
});
