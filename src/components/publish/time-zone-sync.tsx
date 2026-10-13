"use client";

import { useRouter } from "next/navigation";
import { useTimeZone } from "next-intl";
import { useEffect } from "react";

import { TIME_ZONE_COOKIE, TIME_ZONE_COOKIE_MAX_AGE } from "@/lib/publish/time";

/**
 * Tells the server which time zone the browser is in (spec §4.5: "stored UTC,
 * shown in the user's timezone"). The server cannot know it, so the zone is
 * kept in a cookie and every date is formatted with it on both sides — which
 * also means server and client render the same text.
 *
 * Renders nothing. On a first visit (or after travelling) the cookie is set
 * and the page is re-rendered once with the right zone.
 */
export function TimeZoneSync() {
  const current = useTimeZone();
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === current) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; Path=/; Max-Age=${TIME_ZONE_COOKIE_MAX_AGE}; SameSite=Lax`;
    router.refresh();
    // `current` only changes when the server accepted the zone, so a zone the
    // server does not know cannot cause a refresh loop.
  }, [current, router]);

  return null;
}
