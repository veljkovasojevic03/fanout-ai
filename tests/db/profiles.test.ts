import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { asUser, begin, createUser, expectDenied, openDb, rollback, type Db } from "./harness";

let db: Db;

beforeAll(async () => {
  db = await openDb();
});
afterAll(() => db.close());
beforeEach(() => begin(db));
afterEach(() => rollback(db));

const planOf = async (id: string) =>
  (await db.query<{ plan: string }>("select plan from public.profiles where id = $1", [id]))[0]
    ?.plan;

describe("profile bootstrap", () => {
  it("creates a 'free' profile for a regular sign-up", async () => {
    const id = await createUser(db);
    expect(await planOf(id)).toBe("free");
  });

  it("creates a 'guest' profile for an anonymous sign-in", async () => {
    const id = await createUser(db, { anonymous: true });
    expect(await planOf(id)).toBe("guest");
  });

  it("takes the display name from OAuth metadata, trimmed and capped at 80 chars", async () => {
    const id = await createUser(db, { meta: { full_name: `  ${"x".repeat(120)}  ` } });
    const [row] = await db.query<{ display_name: string }>(
      "select display_name from public.profiles where id = $1",
      [id],
    );
    expect(row?.display_name).toBe("x".repeat(80));
  });

  it("ignores a plan smuggled in through user metadata", async () => {
    const id = await createUser(db, { meta: { plan: "pro", full_name: "Mallory" } });
    expect(await planOf(id)).toBe("free");
  });
});

describe("guest → account upgrade", () => {
  it("moves the plan from 'guest' to 'free' when is_anonymous flips to false", async () => {
    const id = await createUser(db, { anonymous: true });
    await db.query("update auth.users set is_anonymous = false, email = $2 where id = $1", [
      id,
      `${id}@fanout.test`,
    ]);
    expect(await planOf(id)).toBe("free");
  });

  it("does not downgrade a plan that is already 'pro'", async () => {
    const id = await createUser(db, { anonymous: true });
    await db.query("update public.profiles set plan = 'pro' where id = $1", [id]);
    await db.query("update auth.users set is_anonymous = false where id = $1", [id]);
    expect(await planOf(id)).toBe("pro");
  });

  it("keeps the guest's saved content after the upgrade", async () => {
    const id = await createUser(db, { anonymous: true });
    await asUser(db, id, () =>
      db.query(
        `insert into public.contents (user_id, type, title, body_md, language)
         values ($1, 'linkedin', 'Kept', 'body', 'en')`,
        [id],
      ),
    );
    await db.query("update auth.users set is_anonymous = false where id = $1", [id]);
    const rows = await asUser(db, id, () => db.query("select title from public.contents"));
    expect(rows).toEqual([{ title: "Kept" }]);
  });
});

describe("profiles: server-only columns (spec §5.1)", () => {
  it("REJECTS an authenticated user's `update profiles set plan = 'pro'`", async () => {
    const id = await createUser(db);
    await asUser(db, id, () =>
      expectDenied(db, "update public.profiles set plan = 'pro' where id = $1", [id]),
    );
    expect(await planOf(id)).toBe("free");
  });

  it.each([
    ["stripe_customer_id", "'cus_fake'"],
    ["stripe_subscription_id", "'sub_fake'"],
    ["subscription_status", "'active'"],
    ["current_period_end", "now() + interval '10 years'"],
    ["id", "gen_random_uuid()"],
  ])("rejects a client update of %s", async (column, value) => {
    const id = await createUser(db);
    await asUser(db, id, () =>
      expectDenied(db, `update public.profiles set ${column} = ${value} where id = $1`, [id]),
    );
  });

  it("rejects a plan change hidden next to an allowed column", async () => {
    const id = await createUser(db);
    await asUser(db, id, () =>
      expectDenied(
        db,
        "update public.profiles set display_name = 'ok', plan = 'pro' where id = $1",
        [id],
      ),
    );
  });

  it("rejects client inserts and deletes on profiles", async () => {
    const id = await createUser(db);
    await asUser(db, id, async () => {
      await expectDenied(
        db,
        "insert into public.profiles (id, plan) values (gen_random_uuid(), 'pro')",
      );
      await expectDenied(db, "delete from public.profiles where id = $1", [id]);
    });
  });

  it("allows updating the whitelisted profile columns", async () => {
    const id = await createUser(db);
    const rows = await asUser(db, id, () =>
      db.query(
        `update public.profiles
         set display_name = 'Ada', ui_language = 'sr',
             default_content_language = 'sr', default_tone = 'funny'
         where id = $1
         returning display_name, ui_language, default_content_language, default_tone`,
        [id],
      ),
    );
    expect(rows).toEqual([
      {
        display_name: "Ada",
        ui_language: "sr",
        default_content_language: "sr",
        default_tone: "funny",
      },
    ]);
  });

  it("cannot see or update another user's profile", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await asUser(db, alice, async () => {
      expect(await db.query("select id from public.profiles")).toEqual([{ id: alice }]);
      const updated = await db.query(
        "update public.profiles set display_name = 'pwned' where id = $1 returning id",
        [bob],
      );
      expect(updated).toEqual([]);
    });
    const [row] = await db.query<{ display_name: string | null }>(
      "select display_name from public.profiles where id = $1",
      [bob],
    );
    expect(row?.display_name).toBeNull();
  });
});
