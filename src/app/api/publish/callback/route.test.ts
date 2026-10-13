// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNATURE_HEADER, signedHeaders, TIMESTAMP_HEADER } from "@/lib/publish/hmac";

import { POST } from "./route";

/*
 * The callback route with REAL signature verification. Only the database is
 * faked: `finish_publish_attempt` answers the way the SQL function does —
 * 'applied' the first time an attempt is finished, 'stale' after that.
 */

const db = vi.hoisted(() => ({
  finished: new Map<string, Record<string, unknown>>(),
  rpcError: null as { code: string } | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== "finish_publish_attempt") throw new Error(`unexpected rpc ${name}`);
      if (db.rpcError) return { data: null, error: db.rpcError };
      const key = String(args.p_attempt);
      if (db.finished.has(key)) return { data: "stale", error: null };
      db.finished.set(key, args);
      return { data: "applied", error: null };
    },
  }),
}));

const SECRET = "test-shared-secret-0123456789";
const JOB = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const ATTEMPT = "0b9d7c1e-2a34-4c56-8d7e-9f0a1b2c3d4e";

const callback = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ jobId: JOB, attemptId: ATTEMPT, ok: true, ...overrides });

type Options = { secret?: string; now?: number; headers?: Record<string, string> };

function post(body: string, { secret = SECRET, now, headers }: Options = {}) {
  return POST(
    new Request("http://localhost/api/publish/callback", {
      method: "POST",
      headers: headers ?? signedHeaders(secret, body, now),
      body,
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("N8N_SHARED_SECRET", SECRET);
  db.finished.clear();
  db.rpcError = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/publish/callback", () => {
  it("applies a correctly signed success", async () => {
    const response = await post(callback());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, outcome: "applied" });
    expect(db.finished.get(ATTEMPT)).toEqual({
      p_job: JOB,
      p_attempt: ATTEMPT,
      p_ok: true,
      p_detail: null,
      p_simulated: false,
    });
  });

  it("stores a failure as a short code, never as text from the request", async () => {
    await post(
      callback({ ok: false, error: "delivery_failed", httpStatus: 429, message: "<b>boom</b>" }),
    );
    expect(db.finished.get(ATTEMPT)).toMatchObject({
      p_ok: false,
      p_detail: "delivery_failed:429",
    });

    db.finished.clear();
    await post(callback({ ok: false, error: "rm -rf /", httpStatus: "many" }));
    expect(db.finished.get(ATTEMPT)).toMatchObject({ p_ok: false, p_detail: "delivery_failed" });
  });

  it("never marks a callback as simulated, whatever the body claims", async () => {
    await post(callback({ simulated: true }));
    expect(db.finished.get(ATTEMPT)).toMatchObject({ p_simulated: false });
  });

  it("rejects a request without a signature and touches nothing", async () => {
    const response = await post(callback(), { headers: {} });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_signature" } });
    expect(db.finished.size).toBe(0);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const response = await post(callback(), { secret: "someone-elses-secret-0123456789" });

    expect(response.status).toBe(401);
    expect(db.finished.size).toBe(0);
  });

  it("rejects a body that was changed after signing", async () => {
    const signed = callback({ ok: false });
    const response = await post(callback({ ok: true }), {
      headers: signedHeaders(SECRET, signed),
    });

    expect(response.status).toBe(401);
    expect(db.finished.size).toBe(0);
  });

  it("rejects a correctly signed request that is older than five minutes", async () => {
    const response = await post(callback(), { now: Date.now() - 6 * 60_000 });

    expect(response.status).toBe(401);
    expect(db.finished.size).toBe(0);
  });

  it("accepts a replay inside the window but changes nothing the second time", async () => {
    const body = callback();
    const headers = signedHeaders(SECRET, body);

    const first = await post(body, { headers });
    const replay = await post(body, { headers });

    await expect(first.json()).resolves.toMatchObject({ outcome: "applied" });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ outcome: "stale" });
    expect(db.finished.size).toBe(1);
  });

  it("answers 400 to a signed body that is not a callback", async () => {
    for (const body of ["not json", JSON.stringify({ jobId: "1", ok: true }), "[]"]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_input" } });
    }
    expect(db.finished.size).toBe(0);
  });

  it("refuses an oversized body before doing any work", async () => {
    const response = await post(callback({ padding: "x".repeat(5000) }));

    expect(response.status).toBe(413);
    expect(db.finished.size).toBe(0);
  });

  it("answers 500 when the database fails, so n8n retries", async () => {
    db.rpcError = { code: "57014" };
    const response = await post(callback());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "server_error" } });
    expect(JSON.stringify(body)).not.toContain("57014");
  });

  it("is switched off without a usable shared secret", async () => {
    for (const secret of ["", "short"]) {
      vi.stubEnv("N8N_SHARED_SECRET", secret);
      // Signed with that very secret: it still must not be accepted.
      const response = await post(callback(), { secret });
      expect(response.status).toBe(503);
    }
    expect(db.finished.size).toBe(0);
  });

  it("reads the headers case-insensitively", async () => {
    const body = callback();
    const signed = signedHeaders(SECRET, body);
    const response = await post(body, {
      headers: {
        "x-timestamp": signed[TIMESTAMP_HEADER],
        "x-signature": signed[SIGNATURE_HEADER],
      },
    });
    expect(response.status).toBe(200);
  });
});
