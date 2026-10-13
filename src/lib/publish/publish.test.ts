// @vitest-environment node
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import {
  DISCORD_WEBHOOK_PATTERN,
  discordDestinationSchema,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  normalizeDiscordWebhookUrl,
} from "./destinations";
import { sendDiscordMessage } from "./discord";
import {
  createDispatcher,
  getPublishConfig,
  N8nDispatcher,
  publishMode,
  SimulatedDispatcher,
  toN8nPayload,
  type DispatchRequest,
} from "./dispatcher";
import { DELIVERY_ERROR_CODES, formatFailure, parseFailure, PUBLISH_ERROR_CODES } from "./errors";
import {
  isUsableSecret,
  REPLAY_WINDOW_SECONDS,
  SIGNATURE_HEADER,
  signedHeaders,
  signPayload,
  TIMESTAMP_HEADER,
  verifyBearer,
  verifySignature,
} from "./hmac";
import {
  buildDelivery,
  DELIVERY_LIMITS,
  renderDiscord,
  renderEmail,
  splitMessage,
  type PublishContent,
} from "./render";
import { runClaimedJob, runTick, type ClaimedJob, type FinishInput, type RunDeps } from "./run";
import {
  callbackSchema,
  checkScheduledAt,
  jobUpdateSchema,
  parseClaimedJobs,
  publishRequestSchema,
  PUBLISH_LIMITS,
} from "./schema";
import {
  dayKey,
  dayRange,
  fromLocalInput,
  isTimeZone,
  monthGrid,
  monthParam,
  parseMonthParam,
  shiftMonth,
  toLocalInput,
} from "./time";

const SECRET = "test-shared-secret-0123456789";
const WEBHOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234";
const JOB = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const ATTEMPT = "0b9d7c1e-2a34-4c56-8d7e-9f0a1b2c3d4e";
const USER = "3c1e8a52-6b7d-4f10-9a2b-5d6e7f8091a2";

describe("HMAC signing (spec §5.9)", () => {
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ jobId: JOB, ok: true });
  const headers = signedHeaders(SECRET, body, now);
  const signed = {
    secret: SECRET,
    timestamp: headers[TIMESTAMP_HEADER],
    signature: headers[SIGNATURE_HEADER],
    body,
    now,
  };

  it("signs `timestamp.body` with HMAC-SHA256", () => {
    expect(headers[TIMESTAMP_HEADER]).toBe("1800000000");
    expect(headers[SIGNATURE_HEADER]).toMatch(/^sha256=[0-9a-f]{64}$/);
    // Derived independently here, so the signed string cannot drift unnoticed.
    expect(signPayload("secret", "1", "{}")).toBe(
      `sha256=${createHmac("sha256", "secret").update("1.{}").digest("hex")}`,
    );
  });

  it("accepts what it signed", () => {
    expect(verifySignature(signed)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    expect(verifySignature({ ...signed, body: body.replace("true", "false") })).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(verifySignature({ ...signed, body: `${body} ` })).toMatchObject({ reason: "mismatch" });
  });

  it("rejects a changed timestamp, because the timestamp is signed too", () => {
    expect(verifySignature({ ...signed, timestamp: "1800000001" })).toMatchObject({
      reason: "mismatch",
    });
  });

  it("rejects a signature made with another secret", () => {
    const other = signedHeaders("another-secret-0123456789", body, now);
    expect(verifySignature({ ...signed, signature: other[SIGNATURE_HEADER] })).toMatchObject({
      reason: "mismatch",
    });
  });

  it("rejects a stale request, and one from the future, outside the 5-minute window", () => {
    const window = REPLAY_WINDOW_SECONDS * 1000;
    expect(verifySignature({ ...signed, now: now + window })).toEqual({ ok: true });
    expect(verifySignature({ ...signed, now: now + window + 1000 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verifySignature({ ...signed, now: now - window - 1000 })).toMatchObject({
      reason: "stale",
    });
  });

  it("rejects missing and malformed headers without throwing", () => {
    expect(verifySignature({ ...signed, signature: null })).toMatchObject({ reason: "missing" });
    expect(verifySignature({ ...signed, timestamp: "" })).toMatchObject({ reason: "missing" });
    for (const signature of ["sha256=abc", "deadbeef", `sha256=${"g".repeat(64)}`, "md5=00"]) {
      expect(verifySignature({ ...signed, signature })).toMatchObject({ reason: "malformed" });
    }
    expect(verifySignature({ ...signed, timestamp: "yesterday" })).toMatchObject({
      reason: "malformed",
    });
  });

  it("checks the cron bearer token in full", () => {
    expect(verifyBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(verifyBearer(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(verifyBearer(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(verifyBearer(SECRET, SECRET)).toBe(false);
    expect(verifyBearer("Bearer ", SECRET)).toBe(false);
    expect(verifyBearer(null, SECRET)).toBe(false);
  });

  it("treats a short secret as no secret", () => {
    expect(isUsableSecret("short")).toBe(false);
    expect(isUsableSecret("")).toBe(false);
    expect(isUsableSecret(undefined)).toBe(false);
    expect(isUsableSecret(SECRET)).toBe(true);
  });
});

describe("Discord webhook URLs", () => {
  it("accepts exactly the Discord webhook form", () => {
    expect(isDiscordWebhookUrl(WEBHOOK)).toBe(true);
  });

  // The same list is fed to the CHECK constraint in tests/db/publishing.test.ts.
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
    [
      "a port",
      "https://discord.com:8443/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ],
    ["a path on top", `${WEBHOOK}/slack`],
    ["a line break", `${WEBHOOK}\nhttps://evil.example`],
    [
      "an internal address",
      "https://169.254.169.254/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ],
    ["a short token", "https://discord.com/api/webhooks/123456789012345678/abc"],
  ])("refuses %s", (_name, url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false);
  });

  it("refuses values that are not strings", () => {
    for (const value of [null, undefined, 42, { url: WEBHOOK }]) {
      expect(isDiscordWebhookUrl(value)).toBe(false);
    }
  });

  it("normalises the variants Discord hands out to the one stored form", () => {
    const id = "123456789012345678";
    const token = "abcdefghijklmnopqrstuvwxyz_ABCD-1234";
    for (const variant of [
      `https://discordapp.com/api/webhooks/${id}/${token}`,
      `https://canary.discord.com/api/webhooks/${id}/${token}`,
      `https://ptb.discord.com/api/v10/webhooks/${id}/${token}`,
      `  https://discord.com/api/webhooks/${id}/${token}/  `,
      `https://discord.com/api/webhooks/${id}/${token}?wait=true`,
    ]) {
      expect(normalizeDiscordWebhookUrl(variant)).toBe(WEBHOOK);
    }
  });

  it("does not normalise anything that is not Discord", () => {
    for (const bad of [
      "",
      "discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://evil.example/?u=https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz#x",
      "javascript:alert(1)",
    ]) {
      expect(normalizeDiscordWebhookUrl(bad)).toBeNull();
    }
  });

  it("matches the pattern in the migration character for character", () => {
    const sql = readFileSync(
      path.resolve(import.meta.dirname, "../../../supabase/migrations/20261013000001_schema.sql"),
      "utf8",
    );
    const inSql = /config ->> 'webhook_url' ~ '([^']+)'/.exec(sql)?.[1];
    expect(inSql).toBe(DISCORD_WEBHOOK_PATTERN.source.replaceAll("\\/", "/"));
  });

  it("masks the URL so it cannot be used", () => {
    const masked = maskDiscordWebhookUrl(WEBHOOK);
    expect(masked).toBe("discord.com/…/5678/••••1234");
    expect(masked).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(maskDiscordWebhookUrl("nonsense")).toBe("••••");
  });

  it("trims and bounds the label", () => {
    expect(
      discordDestinationSchema.parse({ label: "  Team   news ", webhookUrl: WEBHOOK }).label,
    ).toBe("Team news");
    expect(discordDestinationSchema.safeParse({ label: "   ", webhookUrl: WEBHOOK }).success).toBe(
      false,
    );
    expect(
      discordDestinationSchema.safeParse({ label: "x".repeat(61), webhookUrl: WEBHOOK }).success,
    ).toBe(false);
  });
});

describe("time zones (stored UTC, shown in the user's zone)", () => {
  const BELGRADE = "Europe/Belgrade";

  it("knows a real zone from a made-up one", () => {
    expect(isTimeZone(BELGRADE)).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("Europe/Belgrade; Path=/")).toBe(false);
    expect(isTimeZone(undefined)).toBe(false);
  });

  it("converts a local wall-clock time to the right instant, summer and winter", () => {
    // Belgrade is UTC+2 in summer and UTC+1 in winter.
    expect(fromLocalInput("2027-06-01T09:30", BELGRADE)?.toISOString()).toBe(
      "2027-06-01T07:30:00.000Z",
    );
    expect(fromLocalInput("2027-01-15T09:30", BELGRADE)?.toISOString()).toBe(
      "2027-01-15T08:30:00.000Z",
    );
    expect(fromLocalInput("2027-06-01T09:30", "America/New_York")?.toISOString()).toBe(
      "2027-06-01T13:30:00.000Z",
    );
    expect(fromLocalInput("2027-06-01T09:30", "UTC")?.toISOString()).toBe(
      "2027-06-01T09:30:00.000Z",
    );
  });

  it("round-trips an instant through the datetime-local form", () => {
    const instant = new Date("2027-03-10T22:45:00Z");
    for (const zone of [BELGRADE, "America/Los_Angeles", "Asia/Kolkata", "UTC"]) {
      expect(fromLocalInput(toLocalInput(instant, zone), zone)?.toISOString()).toBe(
        instant.toISOString(),
      );
    }
    expect(toLocalInput(instant, BELGRADE)).toBe("2027-03-10T23:45");
    expect(toLocalInput(instant, "Asia/Kolkata")).toBe("2027-03-11T04:15");
  });

  it("moves a time that does not exist (clocks go forward) to one that does", () => {
    // 28 March 2027, 02:00 → 03:00 in Belgrade: 02:30 never happens.
    const instant = fromLocalInput("2027-03-28T02:30", BELGRADE)!;
    expect(instant.toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(toLocalInput(instant, BELGRADE)).toBe("2027-03-28T03:30");
  });

  it("refuses input that is not a real date and time", () => {
    for (const bad of [
      "",
      "tomorrow",
      "2027-02-30T10:00",
      "2027-13-01T10:00",
      "2027-06-01T24:00",
      "2027-06-01",
    ]) {
      expect(fromLocalInput(bad, BELGRADE)).toBeNull();
    }
  });

  it("puts an instant on the day it falls on in the user's zone, not in UTC", () => {
    const lateEvening = new Date("2027-06-01T22:30:00Z");
    expect(dayKey(lateEvening, "UTC")).toBe("2027-06-01");
    expect(dayKey(lateEvening, BELGRADE)).toBe("2027-06-02");
    expect(dayKey(lateEvening, "America/Los_Angeles")).toBe("2027-06-01");
    expect(dayKey(new Date("2027-01-01T00:30:00Z"), "America/New_York")).toBe("2026-12-31");
  });

  it("builds a month view of whole weeks, starting on the locale's first day", () => {
    const june = { year: 2027, month: 6 };
    const monday = monthGrid(june, 1);
    const sunday = monthGrid(june, 0);

    // 1 June 2027 is a Tuesday.
    expect(monday[0]).toBe("2027-05-31");
    expect(monday.at(-1)).toBe("2027-07-04");
    expect(sunday[0]).toBe("2027-05-30");
    expect(sunday.at(-1)).toBe("2027-07-03");
    for (const grid of [monday, sunday]) {
      expect(grid.length % 7).toBe(0);
      expect(grid).toContain("2027-06-01");
      expect(grid).toContain("2027-06-30");
      expect(new Set(grid).size).toBe(grid.length);
    }
    // A leap-year February that fits four weeks exactly.
    expect(monthGrid({ year: 2032, month: 2 }, 0)).toHaveLength(35);
    expect(monthGrid({ year: 2026, month: 2 }, 0)).toHaveLength(28);
  });

  it("asks the database for exactly the instants the view covers in that zone", () => {
    const days = monthGrid({ year: 2027, month: 6 }, 1);
    const range = dayRange(days, BELGRADE);
    expect(range.from.toISOString()).toBe("2027-05-30T22:00:00.000Z");
    expect(range.to.toISOString()).toBe("2027-07-04T22:00:00.000Z");

    // Every instant in the range lands on a day of the grid, and the edges do not.
    expect(days).toContain(dayKey(range.from, BELGRADE));
    expect(days).toContain(dayKey(new Date(range.to.getTime() - 1), BELGRADE));
    expect(days).not.toContain(dayKey(range.to, BELGRADE));
    expect(days).not.toContain(dayKey(new Date(range.from.getTime() - 1), BELGRADE));
  });

  it("reads the month from the URL and falls back to the current one", () => {
    const now = new Date("2026-12-31T23:30:00Z");
    expect(parseMonthParam("2027-06", now, BELGRADE)).toEqual({ year: 2027, month: 6 });
    // In Belgrade it is already January.
    expect(parseMonthParam(undefined, now, BELGRADE)).toEqual({ year: 2027, month: 1 });
    expect(parseMonthParam(undefined, now, "UTC")).toEqual({ year: 2026, month: 12 });
    for (const bad of ["2027-13", "27-06", "2027-6", "9999-01", ["2027-06"], "'; drop"]) {
      expect(parseMonthParam(bad, now, "UTC")).toEqual({ year: 2026, month: 12 });
    }
  });

  it("steps between months across a year boundary", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
    expect(monthParam({ year: 2027, month: 3 })).toBe("2027-03");
  });
});

describe("what gets sent", () => {
  const piece = (overrides: Partial<PublishContent> = {}): PublishContent => ({
    type: "linkedin",
    title: "Ship every week",
    body: "First line.\n\nSecond paragraph.",
    language: "en",
    ...overrides,
  });

  it("sends an email piece under its own Subject line, without the header lines in the text", () => {
    const email = renderEmail(
      piece({
        type: "email",
        title: "Library title",
        body: "Subject: The one habit\nPreheader: Ten seconds a day\n\nHi there,\n\n## Why\n\nBecause **it works**.",
      }),
    )!;
    expect(email.subject).toBe("The one habit");
    expect(email.text).not.toMatch(/Subject:|Preheader:/);
    expect(email.text).toContain("Hi there,");
    // Plain text: the Markdown syntax is gone.
    expect(email.text).toContain("Because it works.");
    expect(email.text).not.toContain("##");
  });

  it("sends every other format under its title", () => {
    expect(renderEmail(piece())).toEqual({
      subject: "Ship every week",
      text: "First line.\n\nSecond paragraph.",
    });
  });

  it("keeps a subject on one line so it cannot add mail headers", () => {
    const email = renderEmail(piece({ title: "Hello\r\nBcc: victim@example.com" }))!;
    expect(email.subject).toBe("Hello Bcc: victim@example.com");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("has nothing to send for an empty piece", () => {
    expect(renderEmail(piece({ body: "   \n\n " }))).toBeNull();
    expect(renderDiscord(piece({ body: "" }))).toBeNull();
    expect(buildDelivery(piece({ body: " " }), { kind: "discord", webhookUrl: WEBHOOK })).toEqual({
      ok: false,
      error: "content_empty",
    });
  });

  it("drops a blog post's SEO front block for Discord", () => {
    const messages = renderDiscord(
      piece({
        type: "blog",
        body: "---\nmeta_title: SEO title\nmeta_description: SEO text\n---\n# Heading\n\nBody.",
      }),
    )!;
    expect(messages).toEqual(["# Heading\n\nBody."]);
  });

  it("splits long text at paragraph breaks and loses nothing", () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i} ${"word ".repeat(40)}`.trim(),
    );
    const text = paragraphs.join("\n\n");
    const chunks = splitMessage(text, 500);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
    // Same words in the same order: nothing cut, nothing repeated.
    expect(chunks.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
    // Every chunk starts at the start of a paragraph.
    for (const chunk of chunks) expect(chunk).toMatch(/^Paragraph \d+/);
  });

  it("splits text with no spaces at all, without breaking a character in two", () => {
    const chunks = splitMessage("😀".repeat(700), 500);
    expect(chunks.join("")).toBe("😀".repeat(700));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      expect(chunk.isWellFormed()).toBe(true);
    }
  });

  it("refuses, rather than truncates, a piece that needs too many Discord messages", () => {
    const long = "word ".repeat(
      (DELIVERY_LIMITS.discordMessageMax * (DELIVERY_LIMITS.discordMaxMessages + 1)) / 5,
    );
    expect(buildDelivery(piece({ body: long }), { kind: "discord", webhookUrl: WEBHOOK })).toEqual({
      ok: false,
      error: "content_too_long",
    });
  });

  it("refuses email when the account has no verified address", () => {
    expect(buildDelivery(piece(), { kind: "email", to: null })).toEqual({
      ok: false,
      error: "email_unverified",
    });
    expect(buildDelivery(piece(), { kind: "email", to: "me@example.com" })).toMatchObject({
      ok: true,
      delivery: { kind: "email", to: "me@example.com", subject: "Ship every week" },
    });
  });
});

describe("dispatchers", () => {
  const request: DispatchRequest = {
    jobId: JOB,
    attemptId: ATTEMPT,
    delivery: { kind: "discord", webhookUrl: WEBHOOK, messages: ["Hello"] },
  };

  it("is chosen by configuration alone", () => {
    expect(publishMode(getPublishConfig({} as NodeJS.ProcessEnv))).toBe("simulated");
    expect(createDispatcher(getPublishConfig({} as NodeJS.ProcessEnv))).toBeInstanceOf(
      SimulatedDispatcher,
    );

    const configured = getPublishConfig({
      N8N_BASE_URL: "http://localhost:5678/",
      N8N_SHARED_SECRET: SECRET,
    } as unknown as NodeJS.ProcessEnv);
    expect(configured.n8nBaseUrl).toBe("http://localhost:5678");
    expect(publishMode(configured)).toBe("n8n");
    expect(createDispatcher(configured)).toBeInstanceOf(N8nDispatcher);
  });

  it("stays simulated when n8n has an address but no usable secret", () => {
    for (const secret of [undefined, "", "short"]) {
      const config = getPublishConfig({
        N8N_BASE_URL: "http://localhost:5678",
        N8N_SHARED_SECRET: secret,
      } as unknown as NodeJS.ProcessEnv);
      expect(publishMode(config)).toBe("simulated");
    }
  });

  it("ignores an N8N_BASE_URL that is not an http(s) URL", () => {
    for (const url of ["localhost:5678", "ftp://n8n.local", "javascript:alert(1)", "   "]) {
      const config = getPublishConfig({
        N8N_BASE_URL: url,
        N8N_SHARED_SECRET: SECRET,
      } as unknown as NodeJS.ProcessEnv);
      expect(config.n8nBaseUrl).toBeNull();
    }
  });

  it("simulated: waits, then reports success flagged as simulated, and sends nothing", async () => {
    const sleep = vi.fn(async () => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await new SimulatedDispatcher({ delayMs: 250, sleep }).dispatch();

    expect(sleep).toHaveBeenCalledWith(250);
    expect(result).toEqual({ status: "done", ok: true, error: null, simulated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("n8n: posts a body whose signature verifies, to the workflow of that kind", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const now = 1_800_000_000_000;

    const result = await new N8nDispatcher({
      baseUrl: "http://localhost:5678",
      secret: SECRET,
      fetch: send,
      now: () => now,
    }).dispatch(request);

    expect(result).toEqual({ status: "accepted" });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("http://localhost:5678/webhook/fanout-publish-discord");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");

    const headers = init.headers as Record<string, string>;
    const body = String(init.body);
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: headers[TIMESTAMP_HEADER],
        signature: headers[SIGNATURE_HEADER],
        body,
        now,
      }),
    ).toEqual({ ok: true });
    expect(JSON.parse(body)).toEqual(toN8nPayload(request));
    expect(JSON.parse(body)).toEqual({
      version: 1,
      jobId: JOB,
      attemptId: ATTEMPT,
      kind: "discord",
      discord: { webhookUrl: WEBHOOK, messages: ["Hello"] },
    });
  });

  it("n8n: reports an unreachable or refusing n8n as a failure, with a code and no detail", async () => {
    const down = new N8nDispatcher({
      baseUrl: "http://localhost:5678",
      secret: SECRET,
      fetch: (async () => {
        throw new TypeError(`connect ECONNREFUSED ${WEBHOOK}`);
      }) as unknown as typeof fetch,
    });
    expect(await down.dispatch(request)).toEqual({
      status: "done",
      ok: false,
      error: "n8n_unreachable",
      simulated: false,
    });

    const refusing = new N8nDispatcher({
      baseUrl: "http://localhost:5678",
      secret: SECRET,
      fetch: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch,
    });
    expect(await refusing.dispatch(request)).toMatchObject({
      ok: false,
      error: "n8n_rejected:404",
    });
  });
});

describe("running a claimed job", () => {
  const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: JOB,
    attemptId: ATTEMPT,
    userId: USER,
    attempt: 1,
    content: { type: "linkedin", title: "Title", body: "Body text.", language: "en" },
    destination: { kind: "email" },
    ...overrides,
  });

  function deps(overrides: Partial<RunDeps> = {}) {
    const finished: FinishInput[] = [];
    const value: RunDeps = {
      dispatcher: new SimulatedDispatcher({ sleep: async () => {} }),
      getVerifiedEmail: async () => "me@example.com",
      finish: async (input) => {
        finished.push(input);
        return "applied";
      },
      ...overrides,
    };
    return { value, finished };
  }

  it("simulated: publishes and records it as simulated", async () => {
    const { value, finished } = deps();

    expect(await runClaimedJob(job(), value)).toEqual({
      jobId: JOB,
      status: "published",
      simulated: true,
      error: null,
    });
    expect(finished).toEqual([
      { jobId: JOB, attemptId: ATTEMPT, ok: true, detail: null, simulated: true },
    ]);
  });

  it("n8n accepted: stays processing and records nothing — the callback will", async () => {
    const dispatch = vi.fn(async () => ({ status: "accepted" as const }));
    const { value, finished } = deps({ dispatcher: { mode: "n8n", dispatch } });

    expect(await runClaimedJob(job(), value)).toMatchObject({ status: "processing" });
    expect(finished).toEqual([]);
    expect(dispatch).toHaveBeenCalledWith({
      jobId: JOB,
      attemptId: ATTEMPT,
      delivery: { kind: "email", to: "me@example.com", subject: "Title", text: "Body text." },
    });
  });

  it("sends email only to the account's own verified address", async () => {
    const dispatch = vi.fn();
    const { value, finished } = deps({
      dispatcher: { mode: "n8n", dispatch },
      getVerifiedEmail: async () => null,
    });

    expect(await runClaimedJob(job(), value)).toMatchObject({
      status: "failed",
      error: "email_unverified",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(finished).toEqual([
      { jobId: JOB, attemptId: ATTEMPT, ok: false, detail: "email_unverified", simulated: false },
    ]);
  });

  it("records a failed delivery with its code", async () => {
    const { value, finished } = deps({
      dispatcher: {
        mode: "n8n",
        dispatch: async () => ({
          status: "done",
          ok: false,
          error: "n8n_rejected:500",
          simulated: false,
        }),
      },
    });

    expect(await runClaimedJob(job(), value)).toMatchObject({
      status: "failed",
      error: "n8n_rejected:500",
    });
    expect(finished[0]).toMatchObject({ ok: false, detail: "n8n_rejected:500" });
  });

  it("turns a crash in the dispatcher or the lookup into a recorded failure", async () => {
    const crashing = deps({
      dispatcher: {
        mode: "n8n",
        dispatch: async () => {
          throw new Error(`boom ${WEBHOOK}`);
        },
      },
    });
    expect(await runClaimedJob(job(), crashing.value)).toMatchObject({
      status: "failed",
      error: "dispatch_error",
    });
    // The stored detail is the code, never the exception text.
    expect(crashing.finished[0]!.detail).toBe("dispatch_error");

    const lookup = deps({
      getVerifiedEmail: async () => {
        throw new Error("auth down");
      },
    });
    expect(await runClaimedJob(job(), lookup.value)).toMatchObject({ error: "dispatch_error" });
  });

  it("does not look up an email address for a Discord job", async () => {
    const getVerifiedEmail = vi.fn();
    const { value } = deps({ getVerifiedEmail });

    await runClaimedJob(job({ destination: { kind: "discord", webhookUrl: WEBHOOK } }), value);

    expect(getVerifiedEmail).not.toHaveBeenCalled();
  });
});

describe("the cron tick", () => {
  const jobs = (count: number): ClaimedJob[] =>
    Array.from({ length: count }, (_, index) => ({
      jobId: `00000000-0000-4000-8000-00000000000${index}`,
      attemptId: `00000000-0000-4000-9000-00000000000${index}`,
      userId: USER,
      attempt: 1,
      content: { type: "linkedin", title: "Title", body: "Body.", language: "en" },
      destination: { kind: "discord", webhookUrl: WEBHOOK },
    }));

  it("keeps alive, fails stuck jobs, then claims and dispatches what is due", async () => {
    const order: string[] = [];
    const finished: FinishInput[] = [];

    const summary = await runTick({
      dispatcher: new SimulatedDispatcher({ sleep: async () => {} }),
      getVerifiedEmail: async () => null,
      finish: async (input) => {
        finished.push(input);
        return "applied";
      },
      keepAlive: async () => {
        order.push("keepAlive");
        return 4;
      },
      failStuck: async () => {
        order.push("failStuck");
        return 1;
      },
      claimDue: async (limit) => {
        order.push(`claimDue:${limit}`);
        return jobs(3);
      },
    });

    expect(order).toEqual(["keepAlive", "failStuck", "claimDue:10"]);
    expect(summary).toEqual({
      pruned: 4,
      stuck: 1,
      claimed: 3,
      published: 3,
      failed: 0,
      accepted: 0,
      errors: 0,
    });
    expect(finished).toHaveLength(3);
  });

  it("counts each outcome, and one broken job does not stop the others", async () => {
    let call = 0;
    const summary = await runTick({
      dispatcher: {
        mode: "n8n",
        dispatch: async () => {
          call += 1;
          if (call === 1) return { status: "accepted" };
          if (call === 2)
            return { status: "done", ok: false, error: "n8n_unreachable", simulated: false };
          return { status: "done", ok: true, error: null, simulated: false };
        },
      },
      getVerifiedEmail: async () => null,
      // The database refuses to record the fourth outcome.
      finish: async (input) => {
        if (input.jobId.endsWith("3")) throw new Error("db down");
        return "applied";
      },
      keepAlive: async () => 0,
      failStuck: async () => 0,
      claimDue: async () => jobs(4),
    });

    expect(summary).toMatchObject({ claimed: 4, accepted: 1, failed: 1, published: 1, errors: 1 });
  });

  it("fails as a whole when the database does not answer, before claiming anything", async () => {
    const claimDue = vi.fn();
    await expect(
      runTick({
        dispatcher: new SimulatedDispatcher({ sleep: async () => {} }),
        getVerifiedEmail: async () => null,
        finish: async () => "applied",
        keepAlive: async () => {
          throw new Error("paused");
        },
        failStuck: async () => 0,
        claimDue,
      }),
    ).rejects.toThrow("paused");
    expect(claimDue).not.toHaveBeenCalled();
  });
});

describe("requests and stored shapes", () => {
  it("accepts a publish request for now or for a UTC instant", () => {
    const base = { contentId: JOB, destination: "email" };
    expect(publishRequestSchema.safeParse({ ...base, scheduledAt: null }).success).toBe(true);
    expect(
      publishRequestSchema.safeParse({ ...base, scheduledAt: "2027-06-01T07:30:00.000Z" }).success,
    ).toBe(true);
    expect(
      publishRequestSchema.safeParse({ ...base, destination: ATTEMPT, scheduledAt: null }).success,
    ).toBe(true);

    for (const bad of [
      { ...base, scheduledAt: "2027-06-01 09:30" },
      { ...base, scheduledAt: "tomorrow" },
      { ...base, destination: "discord", scheduledAt: null },
      { ...base, destination: WEBHOOK, scheduledAt: null },
      { ...base, contentId: "1", scheduledAt: null },
      { destination: "email", scheduledAt: null },
    ]) {
      expect(publishRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("needs something to change in a job update", () => {
    expect(
      jobUpdateSchema.safeParse({ jobId: JOB, scheduledAt: null, destination: null }).success,
    ).toBe(false);
    expect(
      jobUpdateSchema.safeParse({ jobId: JOB, scheduledAt: null, destination: "email" }).success,
    ).toBe(true);
  });

  it("allows times from just now up to a year ahead", () => {
    const now = new Date("2027-01-01T12:00:00Z");
    const at = (ms: number) => checkScheduledAt(new Date(now.getTime() + ms), now);

    expect(at(60_000)).toBeNull();
    expect(at(-PUBLISH_LIMITS.pastGraceMs)).toBeNull();
    expect(at(-PUBLISH_LIMITS.pastGraceMs - 1)).toBe("invalid_time");
    expect(at(PUBLISH_LIMITS.maxAheadDays * 86_400_000)).toBeNull();
    expect(at(PUBLISH_LIMITS.maxAheadDays * 86_400_000 + 1)).toBe("invalid_time");
    expect(checkScheduledAt(new Date("nonsense"), now)).toBe("invalid_time");
  });

  it("reads claimed jobs and refuses a Discord job without a URL", () => {
    const row = {
      job_id: JOB,
      attempt_id: ATTEMPT,
      user_id: USER,
      attempt: 2,
      content_type: "blog",
      content_title: "T",
      content_body: "B",
      content_language: "sr",
      destination_kind: "discord",
      destination_config: { webhook_url: WEBHOOK },
    };
    expect(parseClaimedJobs([row])).toEqual([
      {
        jobId: JOB,
        attemptId: ATTEMPT,
        userId: USER,
        attempt: 2,
        content: { type: "blog", title: "T", body: "B", language: "sr" },
        destination: { kind: "discord", webhookUrl: WEBHOOK },
      },
    ]);
    expect(parseClaimedJobs(null)).toEqual([]);
    expect(
      parseClaimedJobs([{ ...row, destination_kind: "email", destination_config: {} }])[0]!
        .destination,
    ).toEqual({ kind: "email" });
    expect(() => parseClaimedJobs([{ ...row, destination_config: {} }])).toThrow();
  });

  it("reads a callback and ignores anything it does not know", () => {
    expect(callbackSchema.parse({ jobId: JOB, attemptId: ATTEMPT, ok: true })).toEqual({
      jobId: JOB,
      attemptId: ATTEMPT,
      ok: true,
    });
    expect(
      callbackSchema.parse({
        jobId: JOB,
        attemptId: ATTEMPT,
        ok: false,
        error: "<script>alert(1)</script>",
        httpStatus: 99999,
        extra: WEBHOOK,
      }),
    ).toEqual({ jobId: JOB, attemptId: ATTEMPT, ok: false });
    expect(callbackSchema.safeParse({ jobId: "x", attemptId: ATTEMPT, ok: true }).success).toBe(
      false,
    );
    expect(callbackSchema.safeParse({ jobId: JOB, attemptId: ATTEMPT, ok: "yes" }).success).toBe(
      false,
    );
  });

  it("stores failures in the shape the database accepts, and reads them back", () => {
    const shape = /^[a-z0-9_]{1,40}(:[0-9]{3})?$/;
    for (const code of DELIVERY_ERROR_CODES) {
      expect(formatFailure(code)).toMatch(shape);
      expect(formatFailure(code, 429)).toMatch(shape);
      expect(parseFailure(formatFailure(code, 429))).toEqual({ code, httpStatus: 429 });
    }
    expect(formatFailure("delivery_failed", 99999)).toBe("delivery_failed");
    expect(formatFailure("delivery_failed", null)).toBe("delivery_failed");
    expect(parseFailure(null)).toBeNull();
    expect(parseFailure("something_new:503")).toEqual({ code: "delivery_failed", httpStatus: 503 });
  });
});

describe("messages", () => {
  it.each([
    ["en", en],
    ["sr", sr],
  ])("%s has a message for every error and failure code", (_name, messages) => {
    expect(Object.keys(messages.publish.errors).sort()).toEqual([...PUBLISH_ERROR_CODES].sort());
    expect(Object.keys(messages.publish.failures).sort()).toEqual([...DELIVERY_ERROR_CODES].sort());
  });
});

describe("sendDiscordMessage (test message)", () => {
  it("posts to the webhook with mentions switched off and redirects refused", async () => {
    const send = vi.fn(async () => new Response(null, { status: 204 }));

    expect(
      await sendDiscordMessage(WEBHOOK, "Hello @everyone", send as unknown as typeof fetch),
    ).toEqual({
      ok: true,
    });

    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({
      content: "Hello @everyone",
      allowed_mentions: { parse: [] },
    });
  });

  it("never sends a request to anything that is not a Discord webhook", async () => {
    const send = vi.fn();
    for (const url of ["http://169.254.169.254/latest/meta-data", "https://evil.example/x", ""]) {
      expect(await sendDiscordMessage(url, "x", send as unknown as typeof fetch)).toEqual({
        ok: false,
        httpStatus: null,
      });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("reports Discord's refusal and a network failure", async () => {
    const gone = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await sendDiscordMessage(WEBHOOK, "x", gone)).toEqual({ ok: false, httpStatus: 404 });

    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendDiscordMessage(WEBHOOK, "x", down)).toEqual({ ok: false, httpStatus: null });
  });
});
