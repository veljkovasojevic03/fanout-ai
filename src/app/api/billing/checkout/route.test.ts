// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as portal } from "../portal/route";

import { POST as checkout } from "./route";

/* The HTTP face of the billing guards: who gets as far as Stripe at all. */

const session = vi.hoisted(() => ({
  user: null as { id: string; email?: string; is_anonymous?: boolean } | null,
  rateLimit: vi.fn(async () => true),
  adminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({}) }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createSupabaseAdminClient: session.adminClient,
}));
vi.mock("@/lib/generation/server", () => ({
  getRequestUser: async () => session.user,
  withinRateLimit: session.rateLimit,
  retryAfter: () => ({ "Retry-After": "60" }),
}));

const USER = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";

const codeOf = async (response: Response) =>
  ((await response.json()) as { error?: { code?: string } }).error?.code;

beforeEach(() => {
  session.user = null;
  session.rateLimit.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe.each([
  ["checkout", checkout],
  ["portal", portal],
])("POST /api/billing/%s", (_name, route) => {
  it("needs a session", async () => {
    const response = await route();
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
  });

  it("turns a guest away with 'create an account first', before anything else runs", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_1");
    session.user = { id: USER, is_anonymous: true };

    const response = await route();

    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("guest_not_allowed");
    // Not rate limited, no database, no Stripe: the request stops at the door.
    expect(session.rateLimit).not.toHaveBeenCalled();
    expect(session.adminClient).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    session.user = { id: USER, email: "a@example.com" };
    session.rateLimit.mockResolvedValue(false);

    const response = await route();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(session.rateLimit).toHaveBeenCalledWith("billing", USER);
  });

  it("says so when Stripe is not connected, or only a live key is present", async () => {
    session.user = { id: USER, email: "a@example.com" };

    const missing = await route();
    expect(missing.status).toBe(503);
    expect(await codeOf(missing)).toBe("not_configured");

    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_1");
    expect((await route()).status).toBe(503);
    expect(session.adminClient).not.toHaveBeenCalled();
  });

  it("answers with a generic error when the lookup behind it fails", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_unit");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_1");
    session.user = { id: USER, email: "a@example.com" };
    session.adminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "57014" } }) }),
        }),
      }),
    });

    const response = await route();

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("server_error");
    expect(body).not.toContain("57014");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
