import "server-only";

import type { User } from "@supabase/supabase-js";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";

import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/*
 * Who is signed in, and what does their account look like?
 *
 * Every reader here distinguishes three outcomes, because they need three
 * different screens: signed in, signed out (→ login), and "the backend did not
 * answer" (→ the "Demo is waking up" screen, never a misleading logout).
 */

export type SessionState =
  { status: "signed_in"; user: User } | { status: "signed_out" } | { status: "unavailable" };

/** True for network failures and 5xx — the project is unreachable or paused. */
function isOutage(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  return error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500;
}

/**
 * The session, verified with the Supabase Auth server (not just read from the
 * cookie). Cached per request, so layouts and pages can all call it.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  // Anything that asks "who is signed in?" is per-request by definition. Opting
  // out of prerendering here keeps that true even for a build made without env vars.
  await connection();
  if (!isSupabaseConfigured()) return { status: "signed_out" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { status: "signed_in", user: data.user };
    return isOutage(error) ? { status: "unavailable" } : { status: "signed_out" };
  } catch (error) {
    log.error("session.get_user_threw", { name: error instanceof Error ? error.name : "unknown" });
    return { status: "unavailable" };
  }
});

/** The signed-in user, or null when signed out or when the backend is unreachable. */
export async function getCurrentUser(): Promise<User | null> {
  const state = await getSessionState();
  return state.status === "signed_in" ? state.user : null;
}

export const isGuest = (user: User): boolean => user.is_anonymous === true;

export function loginPath(next?: string): Route {
  return (next ? `/login?next=${encodeURIComponent(next)}` : "/login") as Route;
}

const PLANS = ["guest", "free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

const profileSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
  ui_language: z.enum(["en", "sr"]),
  default_content_language: z.enum(["en", "sr"]),
  default_tone: z.enum(["professional", "casual", "funny", "inspirational"]),
  plan: z.enum(PLANS),
});
export type Profile = z.infer<typeof profileSchema>;

const planLimitSchema = z.object({
  plan: z.enum(PLANS),
  generations: z.number().int(),
  period: z.enum(["lifetime", "month"]),
  max_length: z.enum(["short", "medium", "long"]),
});
export type PlanLimit = z.infer<typeof planLimitSchema>;

const usageRowSchema = z.object({
  period: z.string(),
  generations: z.number().int(),
  words: z.number().int(),
});

export type Usage = {
  /** Current period: this UTC month, or the whole guest session. */
  generations: number;
  words: number;
  /** Across every period. */
  totalGenerations: number;
  totalWords: number;
};

export type Account = { profile: Profile; limit: PlanLimit; usage: Usage };

export type AccountResult =
  { ok: true; account: Account } | { ok: false; reason: "unavailable" | "missing" };

/** `YYYY-MM` in UTC — must match `consume_generation()` in the database. */
export function currentUsagePeriod(limit: Pick<PlanLimit, "period">, now = new Date()): string {
  return limit.period === "lifetime" ? "lifetime" : now.toISOString().slice(0, 7);
}

/** First day of next month, UTC — when a monthly allowance resets. */
export function nextResetDate(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function summariseUsage(
  rows: readonly z.infer<typeof usageRowSchema>[],
  period: string,
): Usage {
  const current = rows.find((row) => row.period === period);
  return {
    generations: current?.generations ?? 0,
    words: current?.words ?? 0,
    totalGenerations: rows.reduce((sum, row) => sum + row.generations, 0),
    totalWords: rows.reduce((sum, row) => sum + row.words, 0),
  };
}

type QueryFailure = { error: { code?: string } | null; status: number };

/** PostgREST reports a network failure as status 0; a paused project answers 5xx. */
const queryOutage = ({ error, status }: QueryFailure) =>
  Boolean(error) && (status === 0 || status >= 500);

/**
 * Profile, plan limits and usage, read as the user through RLS.
 * All usage numbers in the UI come from here — one source, one definition.
 */
export const getAccount = cache(async (userId: string): Promise<AccountResult> => {
  try {
    const supabase = await createSupabaseServerClient();

    const profileQuery = await supabase
      .from("profiles")
      .select("id, display_name, ui_language, default_content_language, default_tone, plan")
      .eq("id", userId)
      .maybeSingle();
    if (queryOutage(profileQuery)) return { ok: false, reason: "unavailable" };
    if (profileQuery.error || !profileQuery.data) {
      log.error("account.profile_missing", { code: profileQuery.error?.code ?? "no_row" });
      return { ok: false, reason: "missing" };
    }
    const profile = profileSchema.parse(profileQuery.data);

    const [limitQuery, usageQuery] = await Promise.all([
      supabase
        .from("plan_limits")
        .select("plan, generations, period, max_length")
        .eq("plan", profile.plan)
        .maybeSingle(),
      supabase.from("usage_counters").select("period, generations, words").eq("user_id", userId),
    ]);
    if (queryOutage(limitQuery) || queryOutage(usageQuery)) {
      return { ok: false, reason: "unavailable" };
    }
    if (limitQuery.error || !limitQuery.data || usageQuery.error) {
      log.error("account.limits_missing", {
        code: limitQuery.error?.code ?? usageQuery.error?.code ?? "no_row",
      });
      return { ok: false, reason: "missing" };
    }

    const limit = planLimitSchema.parse(limitQuery.data);
    const rows = z.array(usageRowSchema).parse(usageQuery.data ?? []);
    const usage = summariseUsage(rows, currentUsagePeriod(limit));

    return { ok: true, account: { profile, limit, usage } };
  } catch (error) {
    log.error("account.load_threw", { name: error instanceof Error ? error.name : "unknown" });
    return { ok: false, reason: "unavailable" };
  }
});

export type AppContext = { user: User; account: Account; guest: boolean };

/**
 * For pages under /app: the signed-in user with their account.
 *
 * Redirects to login when signed out. Returns null when the backend is
 * unavailable or the account failed to load — the /app layout renders the
 * right screen for those cases, so a page just returns null too.
 */
export const getAppContext = cache(async (next: string = "/app"): Promise<AppContext | null> => {
  const session = await getSessionState();
  if (session.status === "signed_out") redirect(loginPath(next));
  if (session.status === "unavailable") return null;

  const result = await getAccount(session.user.id);
  if (!result.ok) return null;

  return { user: session.user, account: result.account, guest: isGuest(session.user) };
});
