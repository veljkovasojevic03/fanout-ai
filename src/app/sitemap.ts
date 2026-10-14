import type { MetadataRoute } from "next";

import { PUBLIC_PATHS, siteOrigin } from "@/lib/site";

/** /sitemap.xml — the public pages only. The language is negotiated, so one URL each. */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return PUBLIC_PATHS.map((path) => ({
    url: `${origin}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
