"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Library, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DestinationView } from "@/lib/publish/destinations";
import type { PublishMode } from "@/lib/publish/dispatcher";
import { JOB_STATUSES, type JobView } from "@/lib/publish/schema";
import { dayKeyToDate, monthParam, shiftMonth, type YearMonth } from "@/lib/publish/time";
import { cn } from "@/lib/utils";

import { JobDialog } from "./job-dialog";
import {
  JobStatusBadge,
  SimulatedBadge,
  STATUS_CHIP,
  STATUS_DOT,
  useDestinationName,
} from "./job-status";

/** A job plus the calendar day it falls on in the user's time zone (computed on the server). */
export type CalendarJob = JobView & { day: string };

export type CalendarViewProps = {
  month: YearMonth;
  /** Day keys of the month view, whole weeks (see `monthGrid`). */
  days: readonly string[];
  /** Today's day key in the user's time zone. */
  today: string;
  jobs: readonly CalendarJob[];
  /** Failed jobs from any month. */
  failed: readonly JobView[];
  destinations: readonly DestinationView[];
  email: string | null;
  emailVerified: boolean;
  mode: PublishMode;
};

const VISIBLE_CHIPS = 3;
const POLL_MS = 3000;
const MAX_POLLS = 40;

// Day keys are formatted as dates at noon UTC, so no zone can shift them.
const UTC = { timeZone: "UTC" } as const;

/**
 * The month calendar and the job list (spec §4.5, Phase 6.3). Presentational:
 * the page decides which month and loads the jobs; this renders them, colored
 * by status, and opens the job dialog.
 */
export function CalendarView({
  month,
  days,
  today,
  jobs,
  failed,
  destinations,
  email,
  emailVerified,
  mode,
}: CalendarViewProps) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const key = monthParam(month);
  const inMonth = (day: string) => day.startsWith(key);

  const [selectedDay, setSelectedDay] = useState<string | null>(inMonth(today) ? today : null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  const byDay = new Map<string, CalendarJob[]>();
  for (const job of jobs) byDay.set(job.day, [...(byDay.get(job.day) ?? []), job]);

  const monthJobs = jobs.filter((job) => inMonth(job.day));
  const openJob =
    jobs.find((job) => job.id === openJobId) ?? failed.find((job) => job.id === openJobId) ?? null;

  // A job that is being sent finishes on the server; look again until it has.
  const sending = [...jobs, ...failed].some((job) => job.status === "processing");
  useEffect(() => {
    if (!sending || polls >= MAX_POLLS) return;
    const timer = window.setTimeout(() => {
      setPolls((count) => count + 1);
      router.refresh();
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [sending, polls, router]);

  const monthLabel = format.dateTime(dayKeyToDate(`${key}-01`), {
    month: "long",
    year: "numeric",
    ...UTC,
  });
  const monthHref = (target: YearMonth) => ({
    pathname: "/app/calendar" as const,
    query: { month: monthParam(target) },
  });
  const dayLabel = (day: string) =>
    format.dateTime(dayKeyToDate(day), { weekday: "long", day: "numeric", month: "long", ...UTC });

  const selectedJobs = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="flex flex-col gap-6">
      {mode === "simulated" ? (
        <p className="flex flex-col items-start gap-2 rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] leading-snug text-warn sm:flex-row sm:items-center sm:gap-3">
          <SimulatedBadge />
          {t("publish.simulatedHint")}
        </p>
      ) : null}

      <p aria-live="polite" className={sending ? "flex items-center gap-2 text-sm" : "sr-only"}>
        {sending ? (
          <>
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-warn" />
            {t("calendar.sending")}
          </>
        ) : null}
      </p>

      {failed.length > 0 ? (
        <section aria-labelledby="calendar-failed" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="calendar-failed" className="text-[15px] font-semibold text-danger">
              {t("calendar.failed.title")}
            </h2>
            <p className="text-[13px] leading-snug text-muted">
              {t("calendar.failed.description")}
            </p>
          </div>
          <JobList jobs={failed} onOpen={setOpenJobId} />
        </section>
      ) : null}

      <Tabs defaultValue="calendar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t("calendar.monthNav")} className="flex items-center gap-1.5">
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={monthHref(shiftMonth(month, -1))} aria-label={t("calendar.previous")}>
                <ChevronLeft aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="icon-sm">
              <Link href={monthHref(shiftMonth(month, 1))} aria-label={t("calendar.next")}>
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
            <h2
              aria-live="polite"
              className="ml-2 text-lg font-semibold tracking-tight first-letter:uppercase"
            >
              {monthLabel}
            </h2>
            {inMonth(today) ? null : (
              <Button asChild variant="ghost" size="sm" className="ml-1">
                <Link href="/app/calendar">{t("calendar.today")}</Link>
              </Button>
            )}
          </nav>
          <TabsList aria-label={t("calendar.viewLabel")}>
            <TabsTrigger value="calendar">{t("calendar.views.calendar")}</TabsTrigger>
            <TabsTrigger value="list">{t("calendar.views.list")}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="calendar" className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <div
              aria-hidden="true"
              className="grid grid-cols-7 border-b border-border bg-elevated/60 text-center font-mono text-[11px] tracking-wide text-subtle uppercase"
            >
              {days.slice(0, 7).map((day) => (
                <span key={day} className="px-1 py-2">
                  {format.dateTime(dayKeyToDate(day), { weekday: "short", ...UTC })}
                </span>
              ))}
            </div>

            <ul
              aria-label={t("calendar.gridLabel", { month: monthLabel })}
              className="grid grid-cols-7"
            >
              {days.map((day, index) => {
                const dayJobs = byDay.get(day) ?? [];
                const selected = day === selectedDay;
                return (
                  <li
                    key={day}
                    className={cn(
                      "relative flex min-h-16 flex-col gap-1 border-border p-1.5 sm:min-h-28 sm:p-2",
                      index % 7 !== 6 && "border-r",
                      index < days.length - 7 && "border-b",
                      !inMonth(day) && "bg-black/20",
                      selected && "bg-accent-soft",
                    )}
                  >
                    {/* The day button covers the whole cell; the chips sit above it. */}
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={t("calendar.dayLabel", {
                        date: dayLabel(day),
                        count: dayJobs.length,
                      })}
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-sm font-mono text-xs after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent",
                        day === today
                          ? "bg-accent font-semibold text-accent-foreground"
                          : inMonth(day)
                            ? "text-foreground"
                            : "text-subtle",
                      )}
                    >
                      {Number(day.slice(8))}
                    </button>

                    {/* Phones: one dot per job. The day's jobs are listed below the grid. */}
                    {dayJobs.length > 0 ? (
                      <span aria-hidden="true" className="flex flex-wrap gap-1 sm:hidden">
                        {dayJobs.slice(0, 6).map((job) => (
                          <span
                            key={job.id}
                            className={cn("size-1.5 rounded-full", STATUS_DOT[job.status])}
                          />
                        ))}
                      </span>
                    ) : null}

                    <div className="relative z-10 hidden flex-col gap-1 sm:flex">
                      {dayJobs.slice(0, VISIBLE_CHIPS).map((job) => (
                        <JobChip key={job.id} job={job} onOpen={setOpenJobId} />
                      ))}
                      {dayJobs.length > VISIBLE_CHIPS ? (
                        <span className="px-1 text-[11px] text-muted">
                          {t("calendar.more", { count: dayJobs.length - VISIBLE_CHIPS })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <ul
            aria-label={t("calendar.legend")}
            className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted"
          >
            {JOB_STATUSES.map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", STATUS_DOT[status])}
                />
                {t(`publish.statuses.${status}`)}
              </li>
            ))}
          </ul>

          {selectedDay ? (
            <section aria-labelledby="calendar-day" className="flex flex-col gap-3">
              <h3 id="calendar-day" className="text-[15px] font-semibold first-letter:uppercase">
                {dayLabel(selectedDay)}
              </h3>
              {selectedJobs.length === 0 ? (
                <p className="text-sm text-muted">{t("calendar.dayPanel.empty")}</p>
              ) : (
                <JobList jobs={selectedJobs} onOpen={setOpenJobId} />
              )}
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="list" className="flex flex-col gap-3">
          <h3 className="text-[15px] font-semibold">
            {t("calendar.list.title", { month: monthLabel })}
          </h3>
          {monthJobs.length === 0 ? (
            <p className="text-sm text-muted">{t("calendar.list.empty")}</p>
          ) : (
            <JobList jobs={monthJobs} onOpen={setOpenJobId} />
          )}
        </TabsContent>
      </Tabs>

      {jobs.length === 0 && failed.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("calendar.empty.title")}
          description={t("calendar.empty.description")}
          action={
            <Button asChild variant="secondary">
              <Link href="/app/library">
                <Library aria-hidden="true" />
                {t("calendar.empty.action")}
              </Link>
            </Button>
          }
        />
      ) : null}

      {openJob ? (
        <JobDialog
          // Another job, or the same one in a new state, is a new form.
          key={`${openJob.id}:${openJob.status}:${openJob.scheduledAt}`}
          job={openJob}
          destinations={destinations}
          email={email}
          emailVerified={emailVerified}
          onClose={() => setOpenJobId(null)}
        />
      ) : null}
    </div>
  );
}

type OpenProps = { onOpen(id: string): void };

const TIME = { hour: "numeric", minute: "2-digit" } as const;

function useJobLabel() {
  const t = useTranslations();
  const format = useFormatter();
  return (job: JobView) =>
    t("calendar.job.open", {
      title: job.content.title,
      status: t(`publish.statuses.${job.status}`),
      time: format.dateTime(new Date(job.scheduledAt), { dateStyle: "medium", timeStyle: "short" }),
    });
}

/** One job inside a day cell: time and title, colored by status. */
function JobChip({ job, onOpen }: { job: JobView } & OpenProps) {
  const format = useFormatter();
  const label = useJobLabel();
  return (
    <button
      type="button"
      onClick={() => onOpen(job.id)}
      aria-label={label(job)}
      className={cn(
        "flex w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 text-left text-[11px] leading-4 transition-[filter] hover:brightness-125",
        STATUS_CHIP[job.status],
      )}
    >
      <span className="shrink-0 counter">{format.dateTime(new Date(job.scheduledAt), TIME)}</span>
      <span className="truncate">{job.content.title}</span>
    </button>
  );
}

/** Jobs as rows: status, when, what and where to. Each row opens the job dialog. */
export function JobList({ jobs, onOpen }: { jobs: readonly JobView[] } & OpenProps) {
  const t = useTranslations();
  const format = useFormatter();
  const label = useJobLabel();
  const destinationName = useDestinationName();

  return (
    <Card>
      <ul className="divide-y divide-border">
        {jobs.map((job) => (
          <li key={job.id}>
            <button
              type="button"
              onClick={() => onOpen(job.id)}
              aria-label={label(job)}
              className="flex w-full items-center gap-3.5 rounded-[inherit] px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:-outline-offset-2 sm:px-5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
                <ContentTypeIcon type={job.content.type} className="size-4" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium">{job.content.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                  <span>
                    {format.dateTime(new Date(job.scheduledAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    · {t("calendar.job.to", { destination: destinationName(job.destination) })}
                  </span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                {job.simulated ? <SimulatedBadge /> : null}
                <JobStatusBadge status={job.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
