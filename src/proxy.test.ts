// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNED_IN_HEADER } from "@/lib/auth/hint";

import { proxy } from "./proxy";

const session = vi.hoisted(() => ({ userId: null as string | null, unavailable: false }));

vi.mock("@/lib/supabase/proxy", () => ({
  updateSession: async (request: NextRequest) => {
    const response = NextResponse.next({ request });
    response.cookies.set("sb-refreshed", "1");
    return { response, userId: session.userId, unavailable: session.unavailable };
  },
}));

/** The request headers a response forwards to rendering, as Next encodes them. */
function forwardedHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

const get = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(new URL(path, "http://localhost:3000"), { headers }));

describe("proxy: the landing page's signed-in hint", () => {
  beforeEach(() => {
    session.userId = null;
    session.unavailable = false;
  });

  it("says 1 for a verified user and 0 otherwise", async () => {
    session.userId = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
    expect(forwardedHeader(await get("/"), SIGNED_IN_HEADER)).toBe("1");

    session.userId = null;
    expect(forwardedHeader(await get("/"), SIGNED_IN_HEADER)).toBe("0");
  });

  it("overwrites a value sent by the client", async () => {
    const response = await get("/", { [SIGNED_IN_HEADER]: "1" });
    expect(forwardedHeader(response, SIGNED_IN_HEADER)).toBe("0");
  });

  it("keeps the cookies the session refresh set", async () => {
    const response = await get("/");
    expect(response.headers.get("set-cookie")).toContain("sb-refreshed=1");
  });

  it("does not add the header anywhere else", async () => {
    session.userId = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
    const response = await get("/login");
    expect(forwardedHeader(response, SIGNED_IN_HEADER)).toBeNull();
  });

  it("still sends signed-out visitors of /app to the login page", async () => {
    const response = await get("/app/library");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=%2Fapp%2Flibrary");
  });
});
