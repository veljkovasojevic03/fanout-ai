import "server-only";

import type { User } from "@supabase/supabase-js";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { z } from "zod";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The signed-in user, verified with the Supabase Auth server (not just read
 * from the cookie). Cached per request, so layouts and pages can all call it.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  // Anything that asks "who is signed in?" is per-request by definition. Opting
  // out of prerendering here keeps that true even for a build made without env vars.
  await connection();
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
});

/** Use in protected pages/layouts: returns the user or redirects to the login page. */
export async function requireUser(next?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const query = next ? `?next=${encodeURIComponent(next)}` : "";
    redirect(`/login${query}` as Route);
  }
  return user;
}

export const isGuest = (user: User): boolean => user.is_anonymous === true;

const profileSchema = z.object({
  id: z.uuid(),
  display_name: z.string().nullable(),
  ui_language: z.enum(["en", "sr"]),
  default_content_language: z.enum(["en", "sr"]),
  default_tone: z.enum(["professional", "casual", "funny", "inspirational"]),
  plan: z.enum(["guest", "free", "pro"]),
});

export type Profile = z.infer<typeof profileSchema>;

const planLimitSchema = z.object({
  plan: z.enum(["guest", "free", "pro"]),
  generations: z.number().int(),
  period: z.enum(["lifetime", "month"]),
  max_length: z.enum(["short", "medium", "long"]),
});

export type PlanLimit = z.infer<typeof planLimitSchema>;

export type Account = { profile: Profile; limit: PlanLimit; used: number };

/** `YYYY-MM` in UTC — must match `consume_generation()` in the database. */
export function currentUsagePeriod(limit: Pick<PlanLimit, "period">, now = new Date()): string {
  return limit.period === "lifetime" ? "lifetime" : now.toISOString().slice(0, 7);
}

/**
 * The user's profile, plan limits and usage for the current period, read as the
 * user through RLS. Returns null when the database cannot be reached or the
 * profile is missing, so callers can show an error state instead of crashing.
 */
export const getAccount = cache(async (userId: string): Promise<Account | null> => {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, ui_language, default_content_language, default_tone, plan")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profileRow) return null;
    const profile = profileSchema.parse(profileRow);

    const { data: limitRow, error: limitError } = await supabase
      .from("plan_limits")
      .select("plan, generations, period, max_length")
      .eq("plan", profile.plan)
      .maybeSingle();
    if (limitError || !limitRow) return null;
    const limit = planLimitSchema.parse(limitRow);

    const { data: usageRow, error: usageError } = await supabase
      .from("usage_counters")
      .select("generations")
      .eq("user_id", userId)
      .eq("period", currentUsagePeriod(limit))
      .maybeSingle();
    if (usageError) return null;

    const used = z
      .number()
      .int()
      .catch(0)
      .parse(usageRow?.generations ?? 0);
    return { profile, limit, used };
  } catch {
    return null;
  }
});
