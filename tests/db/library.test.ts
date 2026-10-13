import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  asAnon,
  asService,
  asUser,
  begin,
  CHECK_VIOLATION,
  createUser,
  expectDenied,
  expectSqlError,
  openDb,
  rollback,
  type Db,
} from "./harness";

let db: Db;

beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(async () => {
  await begin(db);
  // The live-budget tests count from zero. Rolled back with everything else.
  await db.query("delete from public.app_counters");
});
afterEach(() => rollback(db));

/** A generation row, inserted the way the server does (service role). */
async function createGeneration(userId: string): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.generations (user_id, topic, tone, length, content_language, types, mode)
     values ($1, 'Topic', 'casual', 'short', 'en', array['blog'], 'sample') returning id`,
    [userId],
  );
  return row!.id;
}

async function createContent(
  userId: string,
  options: { generationId?: string | null; tags?: string[]; title?: string; body?: string } = {},
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.contents (user_id, generation_id, type, title, body_md, language, tone, tags)
     values ($1, $2, 'blog', $3, $4, 'en', 'casual', $5::text[]) returning id`,
    [
      userId,
      options.generationId ?? null,
      options.title ?? "A piece",
      options.body ?? "Body text",
      options.tags ?? [],
    ],
  );
  return row!.id;
}

type Claim = {
  status: string;
  content: { id: string; type: string; language: string; generation_id: string | null } | null;
  mode: string | null;
  model: string | null;
  refinements_left: number | null;
};

type ClaimOptions = { max?: number; wantLive?: boolean; dailyCap?: number; sampleOk?: boolean };

const claim = (userId: string, contentId: string, options: ClaimOptions = {}) =>
  asService(db, async () => {
    const [row] = await db.query<Claim>(
      "select * from public.claim_refinement($1, $2, $3, $4, $5, $6, 'model-free', 'model-pro')",
      [
        userId,
        contentId,
        options.max ?? 10,
        options.wantLive ?? false,
        options.dailyCap ?? 150,
        options.sampleOk ?? true,
      ],
    );
    return row!;
  });

const refinementsUsed = async (generationId: string) =>
  (
    await db.query<{ refinements_used: number }>(
      "select refinements_used from public.generations where id = $1",
      [generationId],
    )
  )[0]!.refinements_used;

const userRefinements = async (userId: string) =>
  (
    await db.query<{ total: number }>(
      "select coalesce(sum(refinements), 0)::int as total from public.usage_counters where user_id = $1",
      [userId],
    )
  )[0]!.total;

const liveRefinementsToday = async () =>
  (
    await db.query<{ total: number }>(
      "select coalesce(sum(real_refinements), 0)::int as total from public.app_counters",
    )
  )[0]!.total;

describe("claim_refinement", () => {
  it("counts a refine against the generation the piece came from", async () => {
    const user = await createUser(db);
    const generation = await createGeneration(user);
    const content = await createContent(user, { generationId: generation });

    const result = await claim(user, content);

    expect(result).toMatchObject({
      status: "ok",
      mode: "sample",
      model: null,
      refinements_left: 9,
    });
    expect(result.content).toMatchObject({ id: content, type: "blog", language: "en" });
    expect(await refinementsUsed(generation)).toBe(1);
    expect(await userRefinements(user)).toBe(1);
  });

  it("stops at the cap and counts nothing beyond it", async () => {
    const user = await createUser(db);
    const generation = await createGeneration(user);
    const content = await createContent(user, { generationId: generation });

    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await claim(user, content, { max: 3 })).status);

    expect(statuses).toEqual(["ok", "ok", "ok", "cap_reached"]);
    expect(await refinementsUsed(generation)).toBe(3);
    expect(await userRefinements(user)).toBe(3);
  });

  it("shares the budget with regenerate, and between pieces of one generation", async () => {
    const user = await createUser(db);
    const generation = await createGeneration(user);
    const first = await createContent(user, { generationId: generation });
    // A duplicate keeps its generation, so it cannot be used to escape the cap.
    const copy = await createContent(user, { generationId: generation, title: "A piece (copy)" });

    await asService(db, async () => {
      await db.query(
        "insert into public.generation_streams (generation_id, type) values ($1, 'blog')",
        [generation],
      );
      await db.query("select * from public.claim_generation_stream($1, $2, 'blog', true, 3)", [
        generation,
        user,
      ]);
    });

    expect((await claim(user, first, { max: 3 })).refinements_left).toBe(1);
    expect((await claim(user, copy, { max: 3 })).refinements_left).toBe(0);
    expect((await claim(user, first, { max: 3 })).status).toBe("cap_reached");
    expect((await claim(user, copy, { max: 3 })).status).toBe("cap_reached");
  });

  it("has no per-generation cap for a piece without a generation", async () => {
    const user = await createUser(db);
    const content = await createContent(user);

    for (let i = 0; i < 12; i += 1) {
      const result = await claim(user, content, { max: 3 });
      expect(result).toMatchObject({ status: "ok", refinements_left: null });
    }
    expect(await userRefinements(user)).toBe(12);
  });

  it("treats another user's piece exactly like a missing one", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const generation = await createGeneration(bob);
    const bobsContent = await createContent(bob, { generationId: generation });

    const foreign = await claim(alice, bobsContent);
    const missing = await claim(alice, "00000000-0000-4000-8000-000000000000");

    expect(foreign).toEqual(missing);
    expect(foreign).toMatchObject({ status: "not_found", content: null });
    expect(await refinementsUsed(generation)).toBe(0);
    expect(await userRefinements(alice)).toBe(0);
  });

  it("goes live while the daily budget lasts, with the model of the user's plan", async () => {
    const free = await createUser(db);
    const pro = await createUser(db);
    await db.query("update public.profiles set plan = 'pro' where id = $1", [pro]);
    const freeContent = await createContent(free);
    const proContent = await createContent(pro);

    expect(await claim(free, freeContent, { wantLive: true, dailyCap: 2 })).toMatchObject({
      mode: "live",
      model: "model-free",
    });
    expect(await claim(pro, proContent, { wantLive: true, dailyCap: 2 })).toMatchObject({
      mode: "live",
      model: "model-pro",
    });
    // The budget is used up: the third one silently becomes a sample refine.
    expect(await claim(free, freeContent, { wantLive: true, dailyCap: 2 })).toMatchObject({
      status: "ok",
      mode: "sample",
      model: null,
    });
    expect(await liveRefinementsToday()).toBe(2);
  });

  it("never goes live when live mode is off or the cap is zero", async () => {
    const user = await createUser(db);
    const content = await createContent(user);

    expect((await claim(user, content, { wantLive: false })).mode).toBe("sample");
    expect((await claim(user, content, { wantLive: true, dailyCap: 0 })).mode).toBe("sample");
    expect(await liveRefinementsToday()).toBe(0);
  });

  it("keeps the live refine budget separate from the live generation budget", async () => {
    const user = await createUser(db);
    const content = await createContent(user);
    await db.query(
      "insert into public.app_counters (day, real_generations) values ((now() at time zone 'utc')::date, 30)",
    );

    expect((await claim(user, content, { wantLive: true, dailyCap: 5 })).mode).toBe("live");
    const [row] = await db.query(
      "select real_generations, real_refinements from public.app_counters",
    );
    expect(row).toEqual({ real_generations: 30, real_refinements: 1 });
  });

  it("refuses a request sample mode cannot serve, without counting it", async () => {
    const user = await createUser(db);
    const generation = await createGeneration(user);
    const content = await createContent(user, { generationId: generation });

    const refused = await claim(user, content, { sampleOk: false });
    expect(refused).toMatchObject({ status: "sample_unsupported", content: null });
    expect(await refinementsUsed(generation)).toBe(0);
    expect(await userRefinements(user)).toBe(0);

    // The same request is fine when a live slot is available.
    const live = await claim(user, content, { sampleOk: false, wantLive: true });
    expect(live).toMatchObject({ status: "ok", mode: "live", refinements_left: 9 });
  });

  it("counts a guest's refinements in their lifetime period", async () => {
    const guest = await createUser(db, { anonymous: true });
    const content = await createContent(guest);
    await claim(guest, content);

    const rows = await db.query(
      "select period, refinements from public.usage_counters where user_id = $1",
      [guest],
    );
    expect(rows).toEqual([{ period: "lifetime", refinements: 1 }]);
  });

  it("can only be executed by the service role", async () => {
    const user = await createUser(db);
    const content = await createContent(user);
    const sql =
      "select * from public.claim_refinement($1, $2, 10, false, 150, true, 'model-free', 'model-pro')";

    await asUser(db, user, () => expectDenied(db, sql, [user, content]));
    await asAnon(db, () => expectDenied(db, sql, [user, content]));
  });
});

describe("contents.tags", () => {
  it("lets a user store well-formed tags on their own piece", async () => {
    const user = await createUser(db);
    const content = await createContent(user);

    await asUser(db, user, async () => {
      const rows = await db.query(
        "update public.contents set tags = array['launch', 'šta je novo', 'q3'] where id = $1 returning tags",
        [content],
      );
      expect(rows).toEqual([{ tags: ["launch", "šta je novo", "q3"] }]);
    });
  });

  it.each([
    ["an empty tag", "array['ok', '']"],
    ["a tag with surrounding spaces", "array[' padded ']"],
    ["a tag longer than 32 characters", `array['${"x".repeat(33)}']`],
    ["a null tag", "array['ok', null]"],
    ["more than 20 tags", `array[${Array.from({ length: 21 }, (_, i) => `'t${i}'`).join(", ")}]`],
  ])("rejects %s", async (_name, tags) => {
    const user = await createUser(db);
    const content = await createContent(user);

    await asUser(db, user, () =>
      expectSqlError(
        db,
        CHECK_VIOLATION,
        `update public.contents set tags = ${tags} where id = $1`,
        [content],
      ),
    );
  });

  it("accepts exactly 32 characters, counted as characters and not bytes", async () => {
    const user = await createUser(db);
    const content = await createContent(user);

    await asUser(db, user, async () => {
      const rows = await db.query(
        "update public.contents set tags = array[$2::text] where id = $1 returning id",
        [content, "š".repeat(32)],
      );
      expect(rows).toHaveLength(1);
    });
  });
});

describe("content_tags()", () => {
  it("lists the caller's own tags, most used first, then alphabetically", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await createContent(alice, { tags: ["launch", "email"] });
    await createContent(alice, { tags: ["launch", "blog"] });
    await createContent(alice, { tags: [] });
    await createContent(bob, { tags: ["secret", "launch"] });

    const rows = await asUser(db, alice, () =>
      db.query<{ tag: string; uses: string | number }>("select * from public.content_tags()"),
    );

    expect(rows.map((row) => [row.tag, Number(row.uses)])).toEqual([
      ["launch", 2],
      ["blog", 1],
      ["email", 1],
    ]);
  });

  it("returns nothing for a user without tags and is not callable when logged out", async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    await createContent(other, { tags: ["private"] });

    const rows = await asUser(db, user, () => db.query("select * from public.content_tags()"));
    expect(rows).toEqual([]);

    await asAnon(db, () => expectDenied(db, "select * from public.content_tags()"));
  });
});

describe("library queries under RLS", () => {
  it("finds a piece by a word prefix in its title or body, and only the caller's own", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await createContent(alice, {
      title: "Pricing workshop",
      body: "How to charge with confidence",
    });
    await createContent(alice, { title: "Weekly update", body: "Nothing about money here" });
    await createContent(bob, { title: "Pricing secrets", body: "Private" });

    const search = (query: string) =>
      asUser(db, alice, () =>
        db.query<{ title: string }>(
          "select title from public.contents where search @@ to_tsquery('simple', $1) order by title",
          [query],
        ),
      );

    // The strings buildSearchQuery() produces for "pric", "charge conf" and "šta".
    expect((await search("pric:*")).map((row) => row.title)).toEqual(["Pricing workshop"]);
    expect((await search("charge:* & conf:*")).map((row) => row.title)).toEqual([
      "Pricing workshop",
    ]);
    expect(await search("šta:*")).toEqual([]);
  });

  it("moves updated_at forward when a piece is edited", async () => {
    const user = await createUser(db);
    const content = await createContent(user);
    // Set the clock back; the trigger would otherwise overwrite it with now().
    await db.query("alter table public.contents disable trigger contents_set_updated_at");
    await db.query(
      "update public.contents set updated_at = now() - interval '1 day' where id = $1",
      [content],
    );
    await db.query("alter table public.contents enable trigger contents_set_updated_at");

    await asUser(db, user, () =>
      db.query("update public.contents set title = 'Edited' where id = $1", [content]),
    );

    const [row] = await db.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 hour' as fresh from public.contents where id = $1",
      [content],
    );
    expect(row!.fresh).toBe(true);
  });

  it("lets a user duplicate their own piece but not attach it to someone else's generation", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const aliceGeneration = await createGeneration(alice);
    const bobGeneration = await createGeneration(bob);

    await asUser(db, alice, async () => {
      const rows = await db.query(
        `insert into public.contents (user_id, generation_id, type, title, body_md, language)
         values ($1, $2, 'blog', 'Copy', 'Body', 'en') returning id`,
        [alice, aliceGeneration],
      );
      expect(rows).toHaveLength(1);

      await expectDenied(
        db,
        `insert into public.contents (user_id, generation_id, type, title, body_md, language)
         values ($1, $2, 'blog', 'Copy', 'Body', 'en')`,
        [alice, bobGeneration],
      );
    });
  });
});
