import "server-only";

import { cookies } from "next/headers";

import { isAppLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type AppLocale } from "./config";

/** The explicitly chosen language, if the visitor has one. */
export async function readLocaleCookie(): Promise<AppLocale | null> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isAppLocale(value) ? value : null;
}

/** Only callable from Server Actions and Route Handlers (cookies are read-only elsewhere). */
export async function writeLocaleCookie(locale: AppLocale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
