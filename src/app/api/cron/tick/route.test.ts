// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/*
 * The tick route end to end, with the database faked at the RPC boundary and
 * the simulated dispatcher doing the "sending" (N8N_BASE_URL is not set).
 */

const WEBHOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234";
const USER = "3c1e8a52-6b7d-4f10-9a2b-5d6e7f8091a2";

const db = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> | undefined }[],
  due: [] as Record<string, unknown>[],
  stuck: 0,
  fail: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createSupabaseAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
    rpc: async (name: string, args?: Record<string, unknown>) => {
      db.calls.push({ name, args });
      if (db.fail === name) return { data: null, error: { code: "57P03" } };
      switch (name) {
        case "prune_rate_limits":
          return { data: 2, error: null };
        case "fail_stuck_publish_jobs":
          return { data: db.stuck, error: null };
        case "claim_due_publish_jobs":
          return { data: db.due, error: null };
        case "finish_publish_attempt":
          return { data: "applied", error: null };
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    },
  }),
}));

const SECRET = "test-cron-secret-0123456789";

const claimed = (index: number) => ({
  job_id: `00000000-0000-4000-8000-00000000000${index}`,
  attempt_id: `00000000-0000-4000-9000-00000000000${index}`,
  user_id: USER,
  attempt: 1,
  content_type: "linkedin",
  content_title: "Title",
  content_body: "Body text.",
  content_language: "en",
  destination_kind: "discord",
  destination_config: { webhook_url: WEBHOOK },
});

const tick = (authorization?: string) =>
  POST(
    new Request("http://localhost/api/cron/tick", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("N8N_BASE_URL", "");
  db.calls.length = 0;
  db.due = [];
  db.stuck = 0;
  db.fail = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/cron/tick", () => {
  it("refuses a request without the secret, and with a wrong one, before touching the database", async () => {
    for (const header of [undefined, "Bearer wrong-secret-0123456789", SECRET, `Basic ${SECRET}`]) {
      const response = await tick(header);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "unauthorized" } });
    }
    expect(db.calls).toEqual([]);
  });

  it("is switched off without a usable CRON_SECRET", async () => {
    for (const secret of ["", "short"]) {
      vi.stubEnv("CRON_SECRET", secret);
      const response = await tick(`Bearer ${secret}`);
      expect(response.status).toBe(503);
    }
    expect(db.calls).toEqual([]);
  });

  it("with nothing due: runs the keep-alive query and reports zeros", async () => {
    const response = await tick(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      pruned: 2,
      stuck: 0,
      claimed: 0,
      published: 0,
      failed: 0,
      accepted: 0,
      errors: 0,
    });
    expect(db.calls.map((call) => call.name)).toEqual([
      "prune_rate_limits",
      "fail_stuck_publish_jobs",
      "claim_due_publish_jobs",
    ]);
  });

  it("claims due jobs, dispatches them and records each outcome as simulated", async () => {
    db.due = [claimed(1), claimed(2)];
    db.stuck = 1;
    vi.useFakeTimers();

    const pending = tick(`Bearer ${SECRET}`);
    // The simulated dispatcher waits a moment before answering.
    await vi.runAllTimersAsync();
    const response = await pending;
    vi.useRealTimers();

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      stuck: 1,
      claimed: 2,
      published: 2,
      failed: 0,
    });
    const finished = db.calls.filter((call) => call.name === "finish_publish_attempt");
    expect(finished.map((call) => call.args)).toEqual([
      {
        p_job: claimed(1).job_id,
        p_attempt: claimed(1).attempt_id,
        p_ok: true,
        p_detail: null,
        p_simulated: true,
      },
      {
        p_job: claimed(2).job_id,
        p_attempt: claimed(2).attempt_id,
        p_ok: true,
        p_detail: null,
        p_simulated: true,
      },
    ]);
  });

  it("answers with counts only — no ids, no content, no webhook URL", async () => {
    db.due = [claimed(1)];
    vi.useFakeTimers();
    const pending = tick(`Bearer ${SECRET}`);
    await vi.runAllTimersAsync();
    const text = await (await pending).text();
    vi.useRealTimers();

    expect(text).not.toContain("discord.com");
    expect(text).not.toContain(claimed(1).job_id);
    expect(text).not.toContain("Body text");
    expect(Object.values(JSON.parse(text)).every((value) => typeof value !== "string")).toBe(true);
  });

  it("answers 503 when the database does not answer", async () => {
    db.fail = "prune_rate_limits";
    const response = await tick(`Bearer ${SECRET}`);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "db_unavailable" } });
    expect(JSON.stringify(body)).not.toContain("57P03");
    expect(db.calls.map((call) => call.name)).toEqual(["prune_rate_limits"]);
  });
});
