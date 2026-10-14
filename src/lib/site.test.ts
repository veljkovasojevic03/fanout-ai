// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

import { ogText } from "./og";
import { PRIVATE_PATHS, siteOrigin } from "./site";

describe("siteOrigin", () => {
  it("uses NEXT_PUBLIC_APP_URL's origin, and localhost without it", () => {
    expect(siteOrigin("https://fanout-ai.vercel.app/some/path")).toBe(
      "https://fanout-ai.vercel.app",
    );
    expect(siteOrigin(undefined)).toBe("http://localhost:3000");
    expect(siteOrigin("not a url")).toBe("http://localhost:3000");
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("keep the app, the API, auth callbacks and /design out of search engines", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fanout-ai.vercel.app");
    const rules = robots();
    vi.unstubAllEnvs();

    expect(rules.rules).toMatchObject({ userAgent: "*", allow: "/" });
    const disallow = (rules.rules as { disallow: string[] }).disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/app", "/api", "/auth", "/design"]));
    // The share image must stay reachable: card crawlers honour robots.txt.
    expect(disallow).not.toContain("/og");
    expect(rules.sitemap).toBe("https://fanout-ai.vercel.app/sitemap.xml");
  });

  it("lists only public pages, as absolute URLs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fanout-ai.vercel.app");
    const urls = sitemap().map((entry) => entry.url);
    vi.unstubAllEnvs();

    expect(urls).toEqual([
      "https://fanout-ai.vercel.app",
      "https://fanout-ai.vercel.app/signup",
      "https://fanout-ai.vercel.app/login",
    ]);
    for (const url of urls) {
      for (const path of PRIVATE_PATHS) expect(new URL(url).pathname.startsWith(path)).toBe(false);
    }
  });
});

describe("share image text", () => {
  it.each(["en", "sr"] as const)(
    "%s uses only characters the built-in OG font can draw",
    (language) => {
      const text = ogText(language);
      for (const value of [text.lead, text.accent, ...text.formats]) {
        expect(value).toMatch(/^[\x20-\x7E]+$/);
      }
      expect(text.formats).toHaveLength(5);
    },
  );
});
