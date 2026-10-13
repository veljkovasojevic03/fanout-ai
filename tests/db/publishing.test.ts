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

const WEBHOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234";

async function addContent(userId: string, title = "A piece"): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `insert into public.contents (user_id, type, title, body_md, language)
     values ($1, 'linkedin', $2, 'Body text', 'en') returning id`,
    [userId, title],
  );
  return row!.id;
}

async function addDestination(userId: string, kind: "email" | "discord" = "email") {
  const [row] = await db.query<{ id: string }>(
    `insert into public.publish_destinations (user_id, kind, label, config)
     values ($1, $2, 'Mine', $3::jsonb) returning id`,
    [userId, kind, JSON.stringify(kind === "discord" ? { webhook_url: WEBHOOK } : {})],
  );
  return row!.id;
}

/** A user with one piece and one destination. */
async function setup(kind: "email" | "discord" = "email") {
  const user = await createUser(db);
  return { user, content: await addContent(user), destination: await addDestination(user, kind) };
}

type Created = { status: string; job_id: string | null };

const create = (
  user: string,
  content: string,
  destination: string,
  when: string | null = null,
  maxOpen = 50,
) =>
  asService(db, async () => {
    const [row] = await db.query<Created>(
      "select * from public.create_publish_job($1, $2, $3, $4, $5)",
      [user, content, destination, when, maxOpen],
    );
    return row!;
  });

type Claimed = {
  job_id: string;
  attempt_id: string;
  user_id: string;
  attempt: number;
  content_type: string;
  content_title: string;
  content_body: string;
  content_language: string;
  destination_kind: string;
  destination_config: Record<string, unknown>;
};

const claimOne = (user: string, job: string) =>
  asService(db, () =>
    db.query<Claimed>("select * from public.claim_publish_job($1, $2)", [user, job]),
  );

const claimDue = (limit = 10) =>
  asService(db, () =>
    db.query<Claimed>("select * from public.claim_due_publish_jobs($1)", [limit]),
  );

const finish = (
  job: string,
  attempt: string,
  ok: boolean,
  detail: string | null,
  simulated = false,
) =>
  asService(db, async () => {
    const [row] = await db.query<{ outcome: string }>(
      "select public.finish_publish_attempt($1, $2, $3, $4, $5) as outcome",
      [job, attempt, ok, detail, simulated],
    );
    return row!.outcome;
  });

const call = (sql: string, params: unknown[]) =>
  asService(db, async () => {
    const [row] = await db.query<{ outcome: string }>(`select ${sql} as outcome`, params);
    return row!.outcome;
  });

const cancel = (user: string, job: string) =>
  call("public.cancel_publish_job($1, $2)", [user, job]);
const retry = (user: string, job: string, max = 5) =>
  call("public.retry_publish_job($1, $2, $3)", [user, job, max]);
const update = (user: string, job: string, when: string | null, destination: string | null) =>
  call("public.update_publish_job($1, $2, $3, $4)", [user, job, when, destination]);

type Job = {
  status: string;
  attempts: number;
  last_error: string | null;
  simulated: boolean;
  published_at: string | Date | null;
  scheduled_at: string | Date;
  destination_id: string;
  processing_at: string | Date | null;
};

const jobOf = async (id: string) =>
  (await db.query<Job>("select * from public.publish_jobs where id = $1", [id]))[0]!;

const attemptsOf = (job: string) =>
  db.query<{ ok: boolean | null; detail: string | null; finished_at: unknown }>(
    "select ok, detail, finished_at from public.publish_attempts where job_id = $1 order by started_at",
    [job],
  );

const futureIso = () => new Date(Date.now() + 3_600_000).toISOString();

describe("create_publish_job", () => {
  it("creates a scheduled job for the caller's own piece and destination", async () => {
    const { user, content, destination } = await setup();

    const created = await create(user, content, destination, futureIso());

    expect(created.status).toBe("ok");
    expect(await jobOf(created.job_id!)).toMatchObject({
      status: "scheduled",
      attempts: 0,
      simulated: false,
      destination_id: destination,
    });
  });

  it("treats no time, and a time in the past, as now", async () => {
    const { user, content, destination } = await setup();

    const now = await create(user, content, destination, null);
    const past = await create(user, content, destination, "2001-01-01T00:00:00Z");

    for (const created of [now, past]) {
      const [row] = await db.query<{ due: boolean; overdue: boolean }>(
        `select scheduled_at <= now() as due, scheduled_at < now() - interval '1 minute' as overdue
         from public.publish_jobs where id = $1`,
        [created.job_id],
      );
      expect(row).toEqual({ due: true, overdue: false });
    }
  });

  it("refuses a time more than a year ahead", async () => {
    const { user, content, destination } = await setup();
    const farAway = new Date(Date.now() + 400 * 86_400_000).toISOString();

    expect(await create(user, content, destination, farAway)).toEqual({
      status: "invalid_time",
      job_id: null,
    });
  });

  it("refuses guests", async () => {
    const guest = await createUser(db, { anonymous: true });
    const content = await addContent(guest);
    // A guest cannot have a destination; one is forced in here to isolate the check.
    const destination = await addDestination(guest);

    expect((await create(guest, content, destination)).status).toBe("guest_not_allowed");
    expect(await db.query("select id from public.publish_jobs")).toEqual([]);
  });

  it("refuses another user's piece and another user's destination", async () => {
    const mine = await setup();
    const theirs = await setup("discord");

    expect((await create(mine.user, theirs.content, mine.destination)).status).toBe(
      "content_not_found",
    );
    expect((await create(mine.user, mine.content, theirs.destination)).status).toBe(
      "destination_not_found",
    );
    expect(await db.query("select id from public.publish_jobs")).toEqual([]);
  });

  it("caps the number of open jobs per user, counting only scheduled and processing", async () => {
    const { user, content, destination } = await setup();

    const first = await create(user, content, destination, futureIso(), 2);
    await create(user, content, destination, futureIso(), 2);
    expect((await create(user, content, destination, futureIso(), 2)).status).toBe("too_many_jobs");

    await cancel(user, first.job_id!);
    expect((await create(user, content, destination, futureIso(), 2)).status).toBe("ok");
  });
});

describe("claiming", () => {
  it("claims one due job: processing, attempt opened, payload returned", async () => {
    const { user, content, destination } = await setup("discord");
    const { job_id } = await create(user, content, destination);

    const [claimed, ...rest] = await claimOne(user, job_id!);

    expect(rest).toEqual([]);
    expect(claimed).toMatchObject({
      job_id,
      user_id: user,
      attempt: 1,
      content_type: "linkedin",
      content_title: "A piece",
      content_body: "Body text",
      content_language: "en",
      destination_kind: "discord",
      destination_config: { webhook_url: WEBHOOK },
    });
    expect(await jobOf(job_id!)).toMatchObject({ status: "processing", attempts: 1 });
    expect((await jobOf(job_id!)).processing_at).not.toBeNull();
    expect(await attemptsOf(job_id!)).toEqual([{ ok: null, detail: null, finished_at: null }]);
  });

  it("claims a job only once", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);

    expect(await claimOne(user, job_id!)).toHaveLength(1);
    expect(await claimOne(user, job_id!)).toEqual([]);
    expect(await claimDue()).toEqual([]);
    expect((await jobOf(job_id!)).attempts).toBe(1);
    expect(await attemptsOf(job_id!)).toHaveLength(1);
  });

  it("does not let one user claim another user's job", async () => {
    const mine = await setup();
    const other = await createUser(db);
    const { job_id } = await create(mine.user, mine.content, mine.destination);

    expect(await claimOne(other, job_id!)).toEqual([]);
    expect((await jobOf(job_id!)).status).toBe("scheduled");
  });

  it("does not claim a job before its time", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination, futureIso());

    expect(await claimOne(user, job_id!)).toEqual([]);
    expect(await claimDue()).toEqual([]);
    expect((await jobOf(job_id!)).status).toBe("scheduled");
  });

  it("the tick claims every due job across users, oldest first, up to the limit", async () => {
    const a = await setup();
    const b = await setup("discord");
    const later = await create(a.user, a.content, a.destination);
    const earlier = await create(b.user, b.content, b.destination);
    const future = await create(a.user, a.content, a.destination, futureIso());
    await db.query(
      "update public.publish_jobs set scheduled_at = now() - interval '5 minutes' where id = $1",
      [earlier.job_id],
    );
    const cancelled = await create(a.user, a.content, a.destination);
    await cancel(a.user, cancelled.job_id!);

    const firstTick = await claimDue(1);
    expect(firstTick.map((row) => row.job_id)).toEqual([earlier.job_id]);

    const secondTick = await claimDue(10);
    expect(secondTick.map((row) => row.job_id)).toEqual([later.job_id]);

    expect((await jobOf(future.job_id!)).status).toBe("scheduled");
    expect((await jobOf(cancelled.job_id!)).status).toBe("cancelled");
  });
});

describe("finish_publish_attempt", () => {
  it("marks a successful attempt published, with the simulated flag", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [claimed] = await claimOne(user, job_id!);

    expect(await finish(job_id!, claimed!.attempt_id, true, null, true)).toBe("applied");

    const job = await jobOf(job_id!);
    expect(job).toMatchObject({
      status: "published",
      simulated: true,
      last_error: null,
      processing_at: null,
    });
    expect(job.published_at).not.toBeNull();
    expect(await attemptsOf(job_id!)).toMatchObject([{ ok: true, detail: null }]);
  });

  it("marks a failed attempt failed and keeps the reason", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [claimed] = await claimOne(user, job_id!);

    expect(await finish(job_id!, claimed!.attempt_id, false, "delivery_failed:429")).toBe(
      "applied",
    );

    expect(await jobOf(job_id!)).toMatchObject({
      status: "failed",
      last_error: "delivery_failed:429",
      published_at: null,
    });
    expect(await attemptsOf(job_id!)).toMatchObject([{ ok: false, detail: "delivery_failed:429" }]);
  });

  it("is idempotent: a replayed callback cannot change the outcome", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [claimed] = await claimOne(user, job_id!);
    await finish(job_id!, claimed!.attempt_id, true, null);
    const before = await jobOf(job_id!);

    expect(await finish(job_id!, claimed!.attempt_id, false, "delivery_failed")).toBe("stale");
    expect(await finish(job_id!, claimed!.attempt_id, true, null, true)).toBe("stale");

    expect(await jobOf(job_id!)).toEqual(before);
  });

  it("ignores an attempt id that belongs to another job", async () => {
    const { user, content, destination } = await setup();
    const one = await create(user, content, destination);
    const two = await create(user, content, destination);
    const [first] = await claimOne(user, one.job_id!);
    await claimOne(user, two.job_id!);

    expect(await finish(two.job_id!, first!.attempt_id, true, null)).toBe("stale");
    expect((await jobOf(two.job_id!)).status).toBe("processing");
  });

  it("ignores the late callback of an earlier attempt after a retry", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [first] = await claimOne(user, job_id!);
    await finish(job_id!, first!.attempt_id, false, "n8n_unreachable");
    await retry(user, job_id!);
    const [second] = await claimOne(user, job_id!);

    expect(await finish(job_id!, first!.attempt_id, true, null)).toBe("stale");
    expect((await jobOf(job_id!)).status).toBe("processing");

    expect(await finish(job_id!, second!.attempt_id, true, null)).toBe("applied");
    expect(await jobOf(job_id!)).toMatchObject({ status: "published", attempts: 2 });
  });

  it("only accepts a short machine code as the failure detail", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [claimed] = await claimOne(user, job_id!);

    await db.query("set local role service_role");
    await expectSqlError(
      db,
      CHECK_VIOLATION,
      "select public.finish_publish_attempt($1, $2, false, $3, false)",
      [job_id, claimed!.attempt_id, `Discord said: ${WEBHOOK} is gone`],
    );
    await db.query("reset role");
    expect((await jobOf(job_id!)).status).toBe("processing");
  });
});

describe("fail_stuck_publish_jobs", () => {
  const failStuck = () =>
    asService(db, async () => {
      const [row] = await db.query<{ count: number }>(
        "select public.fail_stuck_publish_jobs() as count",
      );
      return Number(row!.count);
    });

  it("fails jobs that have been processing for more than ten minutes, and only those", async () => {
    const { user, content, destination } = await setup();
    const stuck = await create(user, content, destination);
    const fresh = await create(user, content, destination);
    const [stuckClaim] = await claimOne(user, stuck.job_id!);
    await claimOne(user, fresh.job_id!);
    await db.query(
      "update public.publish_jobs set processing_at = now() - interval '11 minutes' where id = $1",
      [stuck.job_id],
    );

    expect(await failStuck()).toBe(1);

    expect(await jobOf(stuck.job_id!)).toMatchObject({ status: "failed", last_error: "timeout" });
    expect(await attemptsOf(stuck.job_id!)).toMatchObject([{ ok: false, detail: "timeout" }]);
    expect((await jobOf(fresh.job_id!)).status).toBe("processing");

    // The answer that finally arrives is too late to change anything…
    expect(await finish(stuck.job_id!, stuckClaim!.attempt_id, true, null)).toBe("stale");
    // …but the user can retry.
    expect(await retry(user, stuck.job_id!)).toBe("ok");
    expect(await claimOne(user, stuck.job_id!)).toHaveLength(1);
  });

  it("leaves scheduled jobs alone, however old", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    await db.query(
      "update public.publish_jobs set scheduled_at = now() - interval '2 days' where id = $1",
      [job_id],
    );

    expect(await failStuck()).toBe(0);
    expect((await jobOf(job_id!)).status).toBe("scheduled");
  });
});

describe("retry, cancel and reschedule", () => {
  it("retries only failed jobs, and only up to the attempt cap", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);

    expect(await retry(user, job_id!)).toBe("not_failed");

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const [claimed] = await claimOne(user, job_id!);
      await finish(job_id!, claimed!.attempt_id, false, "delivery_failed");
      if (attempt < 2) expect(await retry(user, job_id!, 2)).toBe("ok");
    }

    expect(await retry(user, job_id!, 2)).toBe("too_many_attempts");
    expect(await jobOf(job_id!)).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("does not let one user retry, cancel or change another user's job", async () => {
    const mine = await setup();
    const other = await createUser(db);
    const { job_id } = await create(mine.user, mine.content, mine.destination, futureIso());

    expect(await retry(other, job_id!)).toBe("not_found");
    expect(await cancel(other, job_id!)).toBe("not_found");
    expect(await update(other, job_id!, futureIso(), null)).toBe("not_found");
    expect((await jobOf(job_id!)).status).toBe("scheduled");
  });

  it("cancels a scheduled job, and nothing that is already under way", async () => {
    const { user, content, destination } = await setup();
    const scheduled = await create(user, content, destination, futureIso());
    const sending = await create(user, content, destination);
    await claimOne(user, sending.job_id!);

    expect(await cancel(user, scheduled.job_id!)).toBe("ok");
    expect(await cancel(user, scheduled.job_id!)).toBe("not_scheduled");
    expect(await cancel(user, sending.job_id!)).toBe("not_scheduled");

    expect((await jobOf(scheduled.job_id!)).status).toBe("cancelled");
    expect((await jobOf(sending.job_id!)).status).toBe("processing");
    expect(await claimDue()).toEqual([]);
  });

  it("dismisses a failed job, keeping its error and attempts, and never a published one", async () => {
    const { user, content, destination } = await setup();
    const failed = await create(user, content, destination);
    const [failedClaim] = await claimOne(user, failed.job_id!);
    await finish(failed.job_id!, failedClaim!.attempt_id, false, "delivery_failed");
    const sent = await create(user, content, destination);
    const [sentClaim] = await claimOne(user, sent.job_id!);
    await finish(sent.job_id!, sentClaim!.attempt_id, true, null);

    expect(await cancel(user, failed.job_id!)).toBe("ok");
    expect(await cancel(user, sent.job_id!)).toBe("not_scheduled");

    expect(await jobOf(failed.job_id!)).toMatchObject({
      status: "cancelled",
      last_error: "delivery_failed",
      attempts: 1,
    });
    expect((await jobOf(sent.job_id!)).status).toBe("published");
    // A dismissed job is over: it cannot be retried or claimed again.
    expect(await retry(user, failed.job_id!)).toBe("not_failed");
    expect(await claimDue()).toEqual([]);
  });

  it("reschedules and changes the destination while scheduled", async () => {
    const { user, content, destination } = await setup();
    const discord = await addDestination(user, "discord");
    const { job_id } = await create(user, content, destination, futureIso());
    const before = await jobOf(job_id!);

    // Destination only: the time stays exactly as it was.
    expect(await update(user, job_id!, null, discord)).toBe("ok");
    const moved = await jobOf(job_id!);
    expect(moved.destination_id).toBe(discord);
    expect(new Date(moved.scheduled_at).getTime()).toBe(new Date(before.scheduled_at).getTime());

    // Time only.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(await update(user, job_id!, tomorrow, null)).toBe("ok");
    const rescheduled = await jobOf(job_id!);
    expect(new Date(rescheduled.scheduled_at).toISOString()).toBe(tomorrow);
    expect(rescheduled.destination_id).toBe(discord);
  });

  it("refuses to reschedule onto someone else's destination, too far ahead, or after the fact", async () => {
    const mine = await setup();
    const theirs = await setup("discord");
    const { job_id } = await create(mine.user, mine.content, mine.destination, futureIso());

    expect(await update(mine.user, job_id!, null, theirs.destination)).toBe(
      "destination_not_found",
    );
    const farAway = new Date(Date.now() + 400 * 86_400_000).toISOString();
    expect(await update(mine.user, job_id!, farAway, null)).toBe("invalid_time");

    await cancel(mine.user, job_id!);
    expect(await update(mine.user, job_id!, futureIso(), null)).toBe("not_scheduled");
  });
});

describe("publishing cannot be driven from the client", () => {
  it("refuses every publishing function to signed-in users and visitors", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination, futureIso());
    const attempt = "00000000-0000-4000-8000-000000000001";

    const calls: [string, unknown[]][] = [
      ["select * from public.create_publish_job($1, $2, $3, null)", [user, content, destination]],
      ["select public.update_publish_job($1, $2, null, null)", [user, job_id]],
      ["select public.cancel_publish_job($1, $2)", [user, job_id]],
      ["select public.retry_publish_job($1, $2)", [user, job_id]],
      ["select * from public.claim_publish_job($1, $2)", [user, job_id]],
      ["select * from public.claim_due_publish_jobs(10)", []],
      ["select * from public.open_publish_attempts($1::uuid[])", [[job_id]]],
      ["select public.finish_publish_attempt($1, $2, true, null, false)", [job_id, attempt]],
      ["select public.fail_stuck_publish_jobs()", []],
    ];

    await asUser(db, user, async () => {
      for (const [sql, params] of calls) await expectDenied(db, sql, params);
    });
    await asAnon(db, async () => {
      for (const [sql, params] of calls) await expectDenied(db, sql, params);
    });
  });

  it("lets a user read their own jobs and attempts but never write them", async () => {
    const { user, content, destination } = await setup();
    const { job_id } = await create(user, content, destination);
    const [claimed] = await claimOne(user, job_id!);

    await asUser(db, user, async () => {
      expect(await db.query("select id from public.publish_jobs")).toEqual([{ id: job_id }]);
      expect(await db.query("select id from public.publish_attempts")).toEqual([
        { id: claimed!.attempt_id },
      ]);

      await expectDenied(db, "update public.publish_jobs set status = 'published' where id = $1", [
        job_id,
      ]);
      await expectDenied(db, "delete from public.publish_jobs where id = $1", [job_id]);
      await expectDenied(
        db,
        `insert into public.publish_jobs (user_id, content_id, destination_id, scheduled_at)
         values ($1, $2, $3, now())`,
        [user, content, destination],
      );
      await expectDenied(db, "update public.publish_attempts set ok = true");
      await expectDenied(db, "insert into public.publish_attempts (job_id) values ($1)", [job_id]);
    });
  });

  it("hides jobs, attempts and destinations from other users", async () => {
    const mine = await setup("discord");
    const other = await createUser(db);
    const { job_id } = await create(mine.user, mine.content, mine.destination);
    await claimOne(mine.user, job_id!);

    await asUser(db, other, async () => {
      expect(await db.query("select id from public.publish_jobs")).toEqual([]);
      expect(await db.query("select id from public.publish_attempts")).toEqual([]);
      expect(await db.query("select id, config from public.publish_destinations")).toEqual([]);
    });
  });
});

describe("destinations", () => {
  it("lets a user add a Discord destination and one email destination, as themselves", async () => {
    const user = await createUser(db);

    await asUser(db, user, async () => {
      await db.query(
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'discord', 'Team', $2::jsonb), ($1, 'email', 'Email', '{}'::jsonb)`,
        [user, JSON.stringify({ webhook_url: WEBHOOK })],
      );
      // A second email destination would be a way to pretend there is another address.
      await expectSqlError(
        db,
        "23505",
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'email', 'Again', '{}'::jsonb)`,
        [user],
      );
    });
  });

  it.each([
    [
      "another host",
      "https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ],
    ["plain http", "http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz"],
    [
      "a look-alike host",
      "https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ],
    ["a query string", `${WEBHOOK}?wait=true`],
    [
      "credentials",
      "https://user:pass@discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ],
  ])("refuses a webhook URL with %s", async (_name, url) => {
    const user = await createUser(db);

    await asUser(db, user, () =>
      expectSqlError(
        db,
        CHECK_VIOLATION,
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'discord', 'Bad', $2::jsonb)`,
        [user, JSON.stringify({ webhook_url: url })],
      ),
    );
  });

  it("refuses an email destination that carries an address", async () => {
    const user = await createUser(db);

    await asUser(db, user, () =>
      expectSqlError(
        db,
        CHECK_VIOLATION,
        `insert into public.publish_destinations (user_id, kind, label, config)
         values ($1, 'email', 'Spam', '{"to":"victim@example.com"}'::jsonb)`,
        [user],
      ),
    );
  });

  it("removes a destination's jobs with it", async () => {
    const { user, content, destination } = await setup();
    await create(user, content, destination, futureIso());

    await asUser(db, user, () =>
      db.query("delete from public.publish_destinations where id = $1", [destination]),
    );

    expect(await db.query("select id from public.publish_jobs")).toEqual([]);
  });
});

describe("time", () => {
  it("stores the scheduled time as an absolute instant", async () => {
    const { user, content, destination } = await setup();
    // 09:30 in Belgrade (UTC+2 in summer) and 07:30 UTC are the same moment.
    await db.query(
      `insert into public.publish_jobs (user_id, content_id, destination_id, scheduled_at)
       values ($1, $2, $3, '2027-06-01T09:30:00+02:00')`,
      [user, content, destination],
    );

    const [row] = await db.query<{ same: boolean }>(
      `select scheduled_at = '2027-06-01T07:30:00Z'::timestamptz as same from public.publish_jobs`,
    );
    expect(row!.same).toBe(true);
  });
});
