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
beforeEach(() => begin(db));
afterEach(() => rollback(db));

const VALID_WEBHOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";

const insertContent = (userId: string, title = "Post") =>
  db.query<{ id: string }>(
    `insert into public.contents (user_id, type, title, body_md, language)
     values ($1, 'blog', $2, 'Hello world', 'en') returning id`,
    [userId, title],
  );

/** Server-side insert of a generation, as /api/generate will do. */
const insertGeneration = (userId: string) =>
  asService(db, async () => {
    const [row] = await db.query<{ id: string }>(
      `insert into public.generations (user_id, topic, tone, length, content_language, types, mode)
       values ($1, 'Topic', 'casual', 'short', 'en', array['blog'], 'sample') returning id`,
      [userId],
    );
    return row!.id;
  });

describe("contents: row-level isolation", () => {
  it("returns nothing when reading another user's contents", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await asUser(db, bob, () => insertContent(bob, "Bob's secret draft"));

    const rows = await asUser(db, alice, () => db.query("select * from public.contents"));
    expect(rows).toEqual([]);
  });

  it("cannot update or delete another user's content", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const [content] = await asUser(db, bob, () => insertContent(bob));

    await asUser(db, alice, async () => {
      expect(
        await db.query("update public.contents set title = 'pwned' where id = $1 returning id", [
          content!.id,
        ]),
      ).toEqual([]);
      expect(
        await db.query("delete from public.contents where id = $1 returning id", [content!.id]),
      ).toEqual([]);
    });

    const [row] = await db.query("select title from public.contents where id = $1", [content!.id]);
    expect(row).toEqual({ title: "Post" });
  });

  it("cannot insert content on behalf of another user", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await asUser(db, alice, () =>
      expectDenied(
        db,
        `insert into public.contents (user_id, type, title, body_md, language)
         values ($1, 'blog', 'Forged', 'x', 'en')`,
        [bob],
      ),
    );
  });

  it("cannot reassign own content to another user", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const [content] = await asUser(db, alice, () => insertContent(alice));
    await asUser(db, alice, () =>
      expectDenied(db, "update public.contents set user_id = $1 where id = $2", [bob, content!.id]),
    );
  });

  it("cannot link content to someone else's generation", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const bobsGeneration = await insertGeneration(bob);
    const alicesGeneration = await insertGeneration(alice);

    await asUser(db, alice, async () => {
      await expectDenied(
        db,
        `insert into public.contents (user_id, generation_id, type, title, body_md, language)
         values ($1, $2, 'blog', 'Linked', 'x', 'en')`,
        [alice, bobsGeneration],
      );
      const rows = await db.query(
        `insert into public.contents (user_id, generation_id, type, title, body_md, language)
         values ($1, $2, 'blog', 'Linked', 'x', 'en') returning title`,
        [alice, alicesGeneration],
      );
      expect(rows).toEqual([{ title: "Linked" }]);
    });
  });

  it("supports full CRUD and search on own content, and bumps updated_at", async () => {
    const alice = await createUser(db);
    await asUser(db, alice, async () => {
      const [created] = await insertContent(alice, "Weekly shipping");
      const [updated] = await db.query<{ tags: string[]; touched: boolean }>(
        `update public.contents set tags = array['growth', 'team'], body_md = 'Ship every Friday'
         where id = $1 returning tags, updated_at >= created_at as touched`,
        [created!.id],
      );
      expect(updated).toEqual({ tags: ["growth", "team"], touched: true });

      const found = await db.query(
        "select title from public.contents where search @@ plainto_tsquery('simple', 'friday')",
      );
      expect(found).toEqual([{ title: "Weekly shipping" }]);

      const byTag = await db.query("select title from public.contents where tags @> array['team']");
      expect(byTag).toHaveLength(1);

      const deleted = await db.query("delete from public.contents where id = $1 returning id", [
        created!.id,
      ]);
      expect(deleted).toHaveLength(1);
    });
  });
});

describe("generations: read own, no client writes", () => {
  it("lets a user read only their own generations", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    const mine = await insertGeneration(alice);
    await insertGeneration(bob);

    const rows = await asUser(db, alice, () => db.query("select id from public.generations"));
    expect(rows).toEqual([{ id: mine }]);
  });

  it("rejects client inserts, updates and deletes", async () => {
    const alice = await createUser(db);
    const id = await insertGeneration(alice);
    await asUser(db, alice, async () => {
      await expectDenied(
        db,
        `insert into public.generations (user_id, topic, tone, length, content_language, types, mode)
         values ($1, 'Free ride', 'casual', 'long', 'en', array['blog'], 'live')`,
        [alice],
      );
      await expectDenied(db, "update public.generations set refinements_used = 0 where id = $1", [
        id,
      ]);
      await expectDenied(db, "delete from public.generations where id = $1", [id]);
    });
  });
});

describe("publish_destinations", () => {
  const insertDestination = (userId: string, kind: string, config: unknown) =>
    db.query(
      `insert into public.publish_destinations (user_id, kind, label, config)
       values ($1, $2, 'My destination', $3::jsonb) returning id`,
      [userId, kind, JSON.stringify(config)],
    );

  it("lets a free user store a valid Discord webhook and an email destination", async () => {
    const user = await createUser(db);
    await asUser(db, user, async () => {
      expect(await insertDestination(user, "discord", { webhook_url: VALID_WEBHOOK })).toHaveLength(
        1,
      );
      expect(await insertDestination(user, "email", {})).toHaveLength(1);
    });
  });

  it("blocks guests from creating destinations", async () => {
    const guest = await createUser(db, { anonymous: true });
    await asUser(db, guest, () =>
      expectDenied(
        db,
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'email', 'Mine', '{}'::jsonb)`,
        [guest],
      ),
    );
  });

  it.each([
    [
      "a non-Discord host",
      { webhook_url: "https://evil.example/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz" },
    ],
    [
      "a look-alike host",
      {
        webhook_url:
          "https://discord.com.evil.example/api/webhooks/123456/abcdefghijklmnopqrstuvwxyz",
      },
    ],
    ["plain http", { webhook_url: VALID_WEBHOOK.replace("https://", "http://") }],
    ["an internal address", { webhook_url: "https://169.254.169.254/latest/meta-data" }],
    ["a trailing path/query", { webhook_url: `${VALID_WEBHOOK}/../../evil?x=1` }],
    ["extra config keys", { webhook_url: VALID_WEBHOOK, also: "this" }],
    ["a missing URL", {}],
  ])("rejects a Discord destination with %s", async (_label, config) => {
    const user = await createUser(db);
    await asUser(db, user, () =>
      expectSqlError(
        db,
        CHECK_VIOLATION,
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'discord', 'Bad', $2::jsonb)`,
        [user, JSON.stringify(config)],
      ),
    );
  });

  it("rejects an email destination that tries to carry a recipient address", async () => {
    const user = await createUser(db);
    await asUser(db, user, () =>
      expectSqlError(
        db,
        CHECK_VIOLATION,
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'email', 'Spam', '{"to": "victim@example.com"}'::jsonb)`,
        [user],
      ),
    );
  });

  it("never returns another user's webhook URL", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await asUser(db, bob, () => insertDestination(bob, "discord", { webhook_url: VALID_WEBHOOK }));
    const rows = await asUser(db, alice, () =>
      db.query("select config from public.publish_destinations"),
    );
    expect(rows).toEqual([]);
  });
});

describe("publish_jobs and publish_attempts: read own, server writes", () => {
  it("shows a user their own jobs and attempts only, and rejects client writes", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);

    const seed = async (userId: string) => {
      const [content] = await asUser(db, userId, () => insertContent(userId));
      const [destination] = await asUser(db, userId, () =>
        db.query<{ id: string }>(
          `insert into public.publish_destinations (user_id, kind, label)
           values ($1, 'email', 'Me') returning id`,
          [userId],
        ),
      );
      return asService(db, async () => {
        const [job] = await db.query<{ id: string }>(
          `insert into public.publish_jobs (user_id, content_id, destination_id, scheduled_at)
           values ($1, $2, $3, now()) returning id`,
          [userId, content!.id, destination!.id],
        );
        await db.query("insert into public.publish_attempts (job_id, ok) values ($1, true)", [
          job!.id,
        ]);
        return { jobId: job!.id, contentId: content!.id, destinationId: destination!.id };
      });
    };

    const mine = await seed(alice);
    await seed(bob);

    await asUser(db, alice, async () => {
      expect(await db.query("select id from public.publish_jobs")).toEqual([{ id: mine.jobId }]);
      expect(await db.query("select job_id from public.publish_attempts")).toEqual([
        { job_id: mine.jobId },
      ]);

      await expectDenied(
        db,
        `insert into public.publish_jobs (user_id, content_id, destination_id, scheduled_at)
         values ($1, $2, $3, now())`,
        [alice, mine.contentId, mine.destinationId],
      );
      await expectDenied(db, "update public.publish_jobs set status = 'published'");
      await expectDenied(db, "delete from public.publish_jobs");
      await expectDenied(db, "insert into public.publish_attempts (job_id, ok) values ($1, true)", [
        mine.jobId,
      ]);
    });
  });
});

describe("server-only tables", () => {
  it.each(["stripe_events", "app_counters", "rate_limits"])(
    "denies signed-in users any access to %s",
    async (table) => {
      const user = await createUser(db);
      await asUser(db, user, () => expectDenied(db, `select * from public.${table}`));
    },
  );

  it("denies signed-in users writes to the server-only tables", async () => {
    const user = await createUser(db);
    await asUser(db, user, async () => {
      await expectDenied(
        db,
        "insert into public.stripe_events (id, type) values ('evt_fake', 'checkout.session.completed')",
      );
      await expectDenied(
        db,
        "insert into public.app_counters (day, real_generations) values (current_date, 0)",
      );
      await expectDenied(db, "delete from public.rate_limits");
    });
  });

  it("lets the service role use them", async () => {
    await asService(db, async () => {
      await db.query("insert into public.stripe_events (id, type) values ('evt_1', 'x')");
      await db.query(
        "insert into public.app_counters (day, real_generations) values (current_date, 1)",
      );
      expect(await db.query("select id from public.stripe_events")).toEqual([{ id: "evt_1" }]);
    });
  });
});

describe("plan_limits", () => {
  it("is seeded exactly as the spec defines the plans", async () => {
    const rows = await db.query("select * from public.plan_limits order by generations");
    expect(rows).toEqual([
      { plan: "guest", generations: 3, period: "lifetime", max_length: "medium" },
      { plan: "free", generations: 5, period: "month", max_length: "medium" },
      { plan: "pro", generations: 100, period: "month", max_length: "long" },
    ]);
  });

  it("is readable but not writable by signed-in users", async () => {
    const user = await createUser(db);
    await asUser(db, user, async () => {
      expect(await db.query("select plan from public.plan_limits")).toHaveLength(3);
      await expectDenied(db, "update public.plan_limits set generations = 1000000");
    });
  });
});

describe("logged-out visitors (anon role)", () => {
  it.each([
    "plan_limits",
    "profiles",
    "usage_counters",
    "generations",
    "contents",
    "publish_destinations",
    "publish_jobs",
    "publish_attempts",
    "stripe_events",
    "app_counters",
    "rate_limits",
  ])("cannot read %s", async (table) => {
    await asAnon(db, () => expectDenied(db, `select * from public.${table}`));
  });
});
