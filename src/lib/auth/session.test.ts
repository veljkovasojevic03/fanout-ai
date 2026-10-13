import { describe, expect, it, vi } from "vitest";

// session.ts is server-only and pulls in Next's request APIs; the functions
// under test here are pure, so those imports are stubbed out.
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const { currentUsagePeriod, nextResetDate, summariseUsage, loginPath } = await import("./session");

describe("currentUsagePeriod", () => {
  it("is 'lifetime' for guest plans", () => {
    expect(currentUsagePeriod({ period: "lifetime" })).toBe("lifetime");
  });

  it("is the UTC year-month for monthly plans, matching consume_generation()", () => {
    expect(currentUsagePeriod({ period: "month" }, new Date("2026-03-15T12:00:00Z"))).toBe(
      "2026-03",
    );
  });

  it("uses UTC, not local time, at month boundaries", () => {
    // 23:30 on 31 Jan in UTC-5 is already February in UTC.
    expect(currentUsagePeriod({ period: "month" }, new Date("2026-02-01T04:30:00Z"))).toBe(
      "2026-02",
    );
  });
});

describe("nextResetDate", () => {
  it("is the first day of the next UTC month", () => {
    expect(nextResetDate(new Date("2026-03-15T12:00:00Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("rolls over the year in December", () => {
    expect(nextResetDate(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("summariseUsage", () => {
  const rows = [
    { period: "2026-02", generations: 5, words: 4200 },
    { period: "2026-03", generations: 2, words: 1500 },
  ];

  it("separates the current period from the all-time totals", () => {
    expect(summariseUsage(rows, "2026-03")).toEqual({
      generations: 2,
      words: 1500,
      totalGenerations: 7,
      totalWords: 5700,
    });
  });

  it("reports zero for a period with no counter row yet", () => {
    expect(summariseUsage(rows, "2026-04")).toMatchObject({ generations: 0, words: 0 });
    expect(summariseUsage([], "lifetime")).toEqual({
      generations: 0,
      words: 0,
      totalGenerations: 0,
      totalWords: 0,
    });
  });
});

describe("loginPath", () => {
  it("encodes the return path", () => {
    expect(loginPath("/app/library?tag=a&b=1")).toBe(
      "/login?next=%2Fapp%2Flibrary%3Ftag%3Da%26b%3D1",
    );
    expect(loginPath()).toBe("/login");
  });
});
