import type { AppLocale } from "@/i18n/config";
import { CONTENT_TYPES } from "@/lib/presets";

import en from "../../messages/en.json";
import sr from "../../messages/sr.json";

/*
 * Text for the share image (GET /og). Only text that ImageResponse's built-in
 * font can draw is used: the tagline and the format names, which are plain
 * ASCII in both languages — a unit test keeps it that way.
 */

const MESSAGES = { en, sr } as const;

export const OG_SIZE = { width: 1200, height: 630 };

/** The strings drawn on the image, in one language. */
export function ogText(language: AppLocale) {
  const m = MESSAGES[language];
  return {
    lead: m.common.taglineLead,
    accent: m.common.taglineAccent,
    formats: CONTENT_TYPES.map((type) => m.common.formats[type]),
  };
}
