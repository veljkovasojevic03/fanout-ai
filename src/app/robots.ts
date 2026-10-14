import type { MetadataRoute } from "next";

import { PRIVATE_PATHS, siteOrigin } from "@/lib/site";

/** /robots.txt — the landing and auth pages may be crawled; the app, the API and /design may not. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
