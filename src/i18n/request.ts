import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { INTL_LOCALE, isAppLocale, LOCALE_COOKIE, matchAcceptLanguage } from "./config";

/**
 * Resolves the locale for each request (no locale in the URL):
 *   1. the language cookie, set by the language switcher or after sign-in;
 *   2. otherwise the browser's Accept-Language header;
 *   3. otherwise English.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;

  const appLocale = isAppLocale(fromCookie)
    ? fromCookie
    : matchAcceptLanguage((await headers()).get("accept-language"));

  const messages = (await import(`../../messages/${appLocale}.json`)).default;

  return {
    locale: INTL_LOCALE[appLocale],
    messages,
    // The server does not know the visitor's time zone; UTC keeps server and
    // client output identical. User-local times arrive with the calendar (Phase 6).
    timeZone: "UTC",
  };
});
