import { ArrowRight, CalendarDays, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getNow, getTimeZone, getTranslations } from "next-intl/server";

import { CalendarView } from "@/components/publish/calendar-view";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toAppLocale } from "@/i18n/config";
import { getAppContext } from "@/lib/auth/session";
import { publishMode } from "@/lib/publish/dispatcher";
import { listDestinations, listFailedJobs, listJobsBetween } from "@/lib/publish/queries";
import { dayKey, dayRange, monthGrid, parseMonthParam, WEEK_STARTS_ON } from "@/lib/publish/time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar");
  return { title: t("metaTitle") };
}

/**
 * The publishing calendar. The month lives in the URL (`?month=YYYY-MM`), so a
 * view can be bookmarked and the back button works. Jobs are stored in UTC and
 * placed on the day they fall on in the user's time zone.
 */
export default async function CalendarPage({ searchParams }: PageProps<"/app/calendar">) {
  const context = await getAppContext("/app/calendar");
  if (!context) return null;

  const [t, timeZone, now, locale, params] = await Promise.all([
    getTranslations("calendar"),
    getTimeZone(),
    getNow(),
    getLocale(),
    searchParams,
  ]);

  const header = <PageHeader title={t("title")} description={t("description", { timeZone })} />;

  // Guests cannot publish (spec §4.1), so they have no calendar to show.
  if (context.guest) {
    return (
      <>
        {header}
        <EmptyState
          icon={<CalendarDays />}
          title={t("guest.title")}
          description={t("guest.description")}
          action={
            <Button asChild>
              <Link href="/app/upgrade">
                {t("guest.action")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  const month = parseMonthParam(params.month, now, timeZone);
  const days = monthGrid(month, WEEK_STARTS_ON[toAppLocale(locale)]);
  const range = dayRange(days, timeZone);

  const [jobs, failed, destinations] = await Promise.all([
    listJobsBetween(range.from, range.to),
    listFailedJobs(),
    listDestinations(),
  ]);

  if (jobs === null) {
    return (
      <>
        {header}
        <EmptyState
          tone="danger"
          icon={<TriangleAlert />}
          title={t("loadError.title")}
          description={t("loadError.description")}
        />
      </>
    );
  }

  const { user } = context;

  return (
    <>
      {header}
      <CalendarView
        month={month}
        days={days}
        today={dayKey(now, timeZone)}
        jobs={jobs.map((job) => ({ ...job, day: dayKey(new Date(job.scheduledAt), timeZone) }))}
        failed={failed}
        destinations={(destinations ?? []).filter((destination) => destination.kind === "discord")}
        email={user.email ?? null}
        emailVerified={Boolean(user.email && user.email_confirmed_at)}
        mode={publishMode()}
      />
    </>
  );
}
