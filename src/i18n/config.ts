/**
 * Locale configuration shared by server and client.
 *
 * The app knows two locales, stored as 'en' | 'sr' (profile column, cookie,
 * message file names). For Intl formatting Serbian must be 'sr-Latn': plain
 * 'sr' makes Intl print dates and plurals in Cyrillic.
 */
export const APP_LOCALES = ["en", "sr"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

/** Remembers the visitor's language. Not sensitive: readable by client code on purpose. */
export const LOCALE_COOKIE = "FANOUT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const INTL_LOCALE = { en: "en", sr: "sr-Latn" } as const satisfies Record<AppLocale, string>;
export type IntlLocale = (typeof INTL_LOCALE)[AppLocale];

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}

/** 'sr-Latn' → 'sr', 'en' → 'en'. */
export function toAppLocale(intlLocale: string): AppLocale {
  return intlLocale.toLowerCase().startsWith("sr") ? "sr" : "en";
}

/**
 * Picks a locale from an Accept-Language header for first-time visitors.
 * Honours q-values; anything that is not Serbian falls back to English.
 */
export function matchAcceptLanguage(header: string | null | undefined): AppLocale {
  if (!header) return DEFAULT_LOCALE;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), weight: Number.isFinite(weight) ? weight : 0 };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (primary === "sr") return "sr";
    if (primary === "en") return "en";
  }
  return DEFAULT_LOCALE;
}
