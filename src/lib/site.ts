/* Public facts about the site, shared by the landing page, metadata, sitemap and robots. */

export const GITHUB_URL = "https://github.com/veljkovasojevic03/fanout-ai";

const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * The public origin, for absolute URLs in the sitemap, robots.txt and
 * metadata. `NEXT_PUBLIC_APP_URL` is authoritative; without it (local
 * development) localhost is the honest answer.
 */
export function siteOrigin(value: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  if (value) {
    try {
      return new URL(value).origin;
    } catch {
      // Malformed: fall through.
    }
  }
  return LOCAL_ORIGIN;
}

/** Pages a search engine may index. Everything under /app, /api, /auth and /design is private. */
export const PUBLIC_PATHS = ["/", "/signup", "/login"] as const;
// /og (the share image) stays crawlable: X's and others' card crawlers honour robots.txt.
export const PRIVATE_PATHS = ["/app", "/api", "/auth", "/design"] as const;
