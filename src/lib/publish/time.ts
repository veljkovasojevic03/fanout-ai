import { TZDate } from "@date-fns/tz";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import type { AppLocale } from "@/i18n/config";

/*
 * Time for the calendar (spec §4.5): instants are stored in UTC and shown in
 * the user's time zone.
 *
 * Two kinds of value are kept strictly apart here:
 *   - an INSTANT (`Date`) — a moment, the same everywhere;
 *   - a DAY KEY (`"2026-10-14"`) or a local input (`"2026-10-14T09:30"`) — a
 *     wall-clock reading that only means something together with a time zone.
 * Every function that crosses between the two takes the zone as an argument;
 * none of them reads the machine's own zone.
 */

/** Remembers the browser's time zone for server rendering. Not sensitive. */
export const TIME_ZONE_COOKIE = "FANOUT_TZ";
export const TIME_ZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const DEFAULT_TIME_ZONE = "UTC";

/** True for an IANA zone name this runtime knows (the cookie is user input). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day an instant falls on in the given zone, as `YYYY-MM-DD`. */
export function dayKey(instant: Date, timeZone: string): string {
  return format(new TZDate(instant.getTime(), timeZone), "yyyy-MM-dd");
}

/** An instant as the value of an `<input type="datetime-local">`, in the given zone. */
export function toLocalInput(instant: Date, timeZone: string): string {
  return format(new TZDate(instant.getTime(), timeZone), "yyyy-MM-dd'T'HH:mm");
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * The instant a wall-clock reading denotes in the given zone, or null when it
 * is not a real date. A time that does not exist (the hour skipped when clocks
 * go forward) moves forward to the next one that does; a time that happens
 * twice (clocks going back) is read as the first occurrence.
 */
export function fromLocalInput(value: string, timeZone: string): Date | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;

  const zoned = new TZDate(year, month - 1, day, hour, minute, timeZone);
  const time = zoned.getTime();
  return Number.isFinite(time) ? new Date(time) : null;
}

export type YearMonth = { year: number; month: number };

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const monthParam = ({ year, month }: YearMonth): string =>
  `${year}-${String(month).padStart(2, "0")}`;

/** The month an instant falls in, in the given zone. */
export function monthOf(instant: Date, timeZone: string): YearMonth {
  const [year, month] = dayKey(instant, timeZone).split("-").map(Number) as [number, number];
  return { year, month };
}

/** Reads `?month=YYYY-MM`; anything else means "the current month". */
export function parseMonthParam(value: unknown, now: Date, timeZone: string): YearMonth {
  const match = typeof value === "string" ? MONTH_PARAM.exec(value) : null;
  if (!match) return monthOf(now, timeZone);
  const year = Number(match[1]);
  // Keeps the navigation inside what a date picker and Postgres both handle.
  if (year < 2000 || year > 2100) return monthOf(now, timeZone);
  return { year, month: Number(match[2]) };
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const shifted = addMonths(new Date(year, month - 1, 1), delta);
  return { year: shifted.getFullYear(), month: shifted.getMonth() + 1 };
}

/** 0 = Sunday, 1 = Monday. English calendars start on Sunday, Serbian ones on Monday. */
export const WEEK_STARTS_ON: Record<AppLocale, 0 | 1> = { en: 0, sr: 1 };

/**
 * The day keys of a month view: whole weeks, from the first day of the week
 * containing the 1st to the last day of the week containing the last day.
 * Pure calendar arithmetic — no instants, so no time zone.
 */
export function monthGrid({ year, month }: YearMonth, weekStartsOn: 0 | 1): string[] {
  const first = new Date(year, month - 1, 1);
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(first), { weekStartsOn }),
    end: endOfWeek(endOfMonth(first), { weekStartsOn }),
  }).map((day) => format(day, "yyyy-MM-dd"));
}

/**
 * The instants that bound a list of consecutive day keys in the given zone:
 * from the first day's midnight (inclusive) to the midnight after the last
 * day (exclusive). This is the range the calendar asks the database for.
 */
export function dayRange(days: readonly string[], timeZone: string): { from: Date; to: Date } {
  const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
  const [fy, fm, fd] = parts(days[0]!);
  const [ty, tm, td] = parts(days.at(-1)!);
  return {
    from: new Date(new TZDate(fy, fm - 1, fd, timeZone).getTime()),
    to: new Date(new TZDate(ty, tm - 1, td + 1, timeZone).getTime()),
  };
}

/** A day key as an instant at noon UTC — safe to format as a date with `timeZone: "UTC"`. */
export const dayKeyToDate = (key: string): Date => new Date(`${key}T12:00:00Z`);
