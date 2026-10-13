"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import { withinRateLimit, type RateLimitName } from "@/lib/generation/server";
import { log } from "@/lib/log";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  DESTINATION_LIMITS,
  discordDestinationSchema,
  isDiscordWebhookUrl,
  normalizeDiscordWebhookUrl,
  type DestinationRef,
  type DestinationView,
} from "./destinations";
import { sendDiscordMessage } from "./discord";
import { publishMode, type PublishMode } from "./dispatcher";
import type { PublishErrorCode } from "./errors";
import { listDestinations } from "./queries";
import { runClaimedJob, type RunOutcome } from "./run";
import {
  checkScheduledAt,
  destinationIdSchema,
  jobIdSchema,
  jobUpdateSchema,
  PUBLISH_LIMITS,
  publishRequestSchema,
} from "./schema";
import { claimJob, createRunDeps } from "./server";

/*
 * Publishing mutations (spec §4.5).
 *
 * Destinations are the user's own rows: they are written as the user, so RLS
 * is the ownership check (and refuses guests). Jobs are server-written: every
 * change goes through a SQL function with the service role, and each of those
 * functions checks the owner itself — the user id passed to them always comes
 * from the verified session, never from the request.
 */

type Failure = { ok: false; code: PublishErrorCode };
const fail = (code: PublishErrorCode): Failure => ({ ok: false, code });

const threw = (event: string, error: unknown) =>
  log.error(event, { name: error instanceof Error ? error.name : "unknown" });

type Session = { ok: true; user: User; supabase: SupabaseClient };

/** Who is asking, and may they? Guests are refused before anything else is touched. */
async function begin(...limits: RateLimitName[]): Promise<Session | Failure> {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) return fail("not_configured");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return fail("unauthenticated");
  if (user.is_anonymous === true) return fail("guest_not_allowed");

  for (const limit of limits) {
    if (!(await withinRateLimit(limit, user.id))) return fail("rate_limited");
  }
  return { ok: true, user, supabase };
}

const hasVerifiedEmail = (user: User) => Boolean(user.email && user.email_confirmed_at);

/**
 * The id of the destination a request names. "email" is the built-in one: its
 * row is created the first time it is used. An email destination is only
 * usable once the account's address is verified.
 */
async function resolveDestination(
  { supabase, user }: Session,
  ref: DestinationRef,
): Promise<{ ok: true; id: string } | Failure> {
  if (ref !== "email") {
    const { data, error } = await supabase
      .from("publish_destinations")
      .select("id, kind")
      .eq("id", ref)
      .maybeSingle();
    if (error) throw new Error(`destination lookup failed: ${error.code}`);
    if (!data) return fail("destination_not_found");
    if (data.kind === "email" && !hasVerifiedEmail(user)) return fail("email_unverified");
    return { ok: true, id: String(data.id) };
  }

  if (!hasVerifiedEmail(user)) return fail("email_unverified");

  const find = () =>
    supabase.from("publish_destinations").select("id").eq("kind", "email").maybeSingle();

  const existing = await find();
  if (existing.error) throw new Error(`destination lookup failed: ${existing.error.code}`);
  if (existing.data) return { ok: true, id: String(existing.data.id) };

  // The config is empty on purpose: the address is always read from the account.
  const inserted = await supabase
    .from("publish_destinations")
    .insert({ user_id: user.id, kind: "email", label: "Email", config: {} })
    .select("id")
    .maybeSingle();
  if (inserted.data) return { ok: true, id: String(inserted.data.id) };

  // Two requests at once: the unique index let one through; read that one.
  const raced = await find();
  if (raced.data) return { ok: true, id: String(raced.data.id) };
  throw new Error(`destination insert failed: ${inserted.error?.code ?? "no_row"}`);
}

/** What the publish dialog needs to offer. Loaded when the dialog opens. */
export type PublishOptions = {
  /** The account's address, shown next to the email destination. */
  email: string | null;
  emailVerified: boolean;
  /** Discord destinations (the email one is always offered separately). */
  destinations: DestinationView[];
  mode: PublishMode;
};

export type PublishOptionsResult = { ok: true; options: PublishOptions } | Failure;

export async function getPublishOptionsAction(): Promise<PublishOptionsResult> {
  try {
    const session = await begin();
    if (!session.ok) return session;

    const destinations = await listDestinations();
    if (!destinations) return fail("server_error");

    return {
      ok: true,
      options: {
        email: session.user.email ?? null,
        emailVerified: hasVerifiedEmail(session.user),
        destinations: destinations.filter((destination) => destination.kind === "discord"),
        mode: publishMode(),
      },
    };
  } catch (error) {
    threw("publish.options_threw", error);
    return fail("server_error");
  }
}

export type PublishResult =
  | {
      ok: true;
      jobId: string;
      /** 'scheduled' for later; otherwise what happened when it was sent just now. */
      status: RunOutcome["status"] | "scheduled";
      simulated: boolean;
      /** A stored failure code when `status` is 'failed'. */
      error: string | null;
    }
  | Failure;

const CREATE_ERRORS: Record<string, PublishErrorCode> = {
  guest_not_allowed: "guest_not_allowed",
  content_not_found: "content_not_found",
  destination_not_found: "destination_not_found",
  invalid_time: "invalid_time",
  too_many_jobs: "too_many_jobs",
};

const statusRow = z.object({ status: z.string(), job_id: z.uuid().nullable() });

/** Claims a due job and sends it. The job is the caller's own (checked in SQL). */
async function sendNow(userId: string, jobId: string): Promise<PublishResult> {
  const admin = createSupabaseAdminClient();
  const claimed = await claimJob(admin, userId, jobId);
  // Not claimable any more: the cron tick got there first. It is being sent either way.
  if (!claimed) return { ok: true, jobId, status: "processing", simulated: false, error: null };

  const outcome = await runClaimedJob(claimed, createRunDeps(admin));
  return { ok: true, ...outcome };
}

/**
 * "Publish now" (scheduledAt = null) or "Schedule". The piece that goes out is
 * the saved version at the moment of sending, not at the moment of scheduling.
 */
export async function createPublishJobAction(input: unknown): Promise<PublishResult> {
  const parsed = publishRequestSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { contentId, destination, scheduledAt } = parsed.data;

  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (when && checkScheduledAt(when)) return fail("invalid_time");

  try {
    const session = await begin("publish", "publishDaily");
    if (!session.ok) return session;

    const resolved = await resolveDestination(session, destination);
    if (!resolved.ok) return resolved;

    const { data, error } = await createSupabaseAdminClient().rpc("create_publish_job", {
      p_user: session.user.id,
      p_content: contentId,
      p_destination: resolved.id,
      p_scheduled_at: when?.toISOString() ?? null,
      p_max_open: PUBLISH_LIMITS.maxOpenJobs,
    });
    const created = statusRow.safeParse(Array.isArray(data) ? data[0] : data);
    if (error || !created.success) {
      log.error("publish.create_failed", { code: error?.code ?? "bad_result" });
      return fail("server_error");
    }
    if (created.data.status !== "ok" || !created.data.job_id) {
      return fail(CREATE_ERRORS[created.data.status] ?? "server_error");
    }

    const jobId = created.data.job_id;
    revalidatePath("/app/calendar");

    if (when && when.getTime() > Date.now()) {
      return { ok: true, jobId, status: "scheduled", simulated: false, error: null };
    }
    return await sendNow(session.user.id, jobId);
  } catch (error) {
    threw("publish.create_threw", error);
    return fail("server_error");
  }
}

export type JobActionResult = { ok: true } | Failure;

const UPDATE_ERRORS: Record<string, PublishErrorCode> = {
  not_found: "job_not_found",
  not_scheduled: "not_scheduled",
  not_failed: "not_failed",
  destination_not_found: "destination_not_found",
  invalid_time: "invalid_time",
  too_many_attempts: "too_many_attempts",
};

function jobOutcome(event: string, data: unknown, error: { code?: string } | null) {
  if (error || typeof data !== "string") {
    log.error(event, { code: error?.code ?? "bad_result" });
    return fail("server_error");
  }
  if (data !== "ok") return fail(UPDATE_ERRORS[data] ?? "server_error");
  revalidatePath("/app/calendar");
  return null;
}

/** Reschedule and/or change the destination of a job that has not gone out yet. */
export async function updatePublishJobAction(input: unknown): Promise<JobActionResult> {
  const parsed = jobUpdateSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { jobId, scheduledAt, destination } = parsed.data;

  const when = scheduledAt ? new Date(scheduledAt) : null;
  if (when && checkScheduledAt(when)) return fail("invalid_time");

  try {
    const session = await begin("publishWrite");
    if (!session.ok) return session;

    let destinationId: string | null = null;
    if (destination) {
      const resolved = await resolveDestination(session, destination);
      if (!resolved.ok) return resolved;
      destinationId = resolved.id;
    }

    const { data, error } = await createSupabaseAdminClient().rpc("update_publish_job", {
      p_user: session.user.id,
      p_job: jobId,
      p_scheduled_at: when?.toISOString() ?? null,
      p_destination: destinationId,
    });
    return jobOutcome("publish.update_failed", data, error) ?? { ok: true };
  } catch (error) {
    threw("publish.update_threw", error);
    return fail("server_error");
  }
}

/** Cancels a job that has not gone out yet, or dismisses one that failed. */
export async function cancelPublishJobAction(input: unknown): Promise<JobActionResult> {
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");

  try {
    const session = await begin("publishWrite");
    if (!session.ok) return session;

    const { data, error } = await createSupabaseAdminClient().rpc("cancel_publish_job", {
      p_user: session.user.id,
      p_job: parsed.data.jobId,
    });
    return jobOutcome("publish.cancel_failed", data, error) ?? { ok: true };
  } catch (error) {
    threw("publish.cancel_threw", error);
    return fail("server_error");
  }
}

/** Retry a failed job: back to 'scheduled', due now, and sent straight away. */
export async function retryPublishJobAction(input: unknown): Promise<PublishResult> {
  const parsed = jobIdSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");
  const { jobId } = parsed.data;

  try {
    // A retry sends a message, so it counts against the same limits as publishing.
    const session = await begin("publish", "publishDaily");
    if (!session.ok) return session;

    const { data, error } = await createSupabaseAdminClient().rpc("retry_publish_job", {
      p_user: session.user.id,
      p_job: jobId,
      p_max_attempts: PUBLISH_LIMITS.maxAttempts,
    });
    const failure = jobOutcome("publish.retry_failed", data, error);
    if (failure) return failure;

    return await sendNow(session.user.id, jobId);
  } catch (error) {
    threw("publish.retry_threw", error);
    return fail("server_error");
  }
}

/* ---- destinations ---- */

export type DestinationResult = { ok: true } | Failure;

export async function addDiscordDestinationAction(input: unknown): Promise<DestinationResult> {
  const parsed = discordDestinationSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");

  const webhookUrl = normalizeDiscordWebhookUrl(parsed.data.webhookUrl);
  if (!webhookUrl) return fail("invalid_webhook_url");

  try {
    const session = await begin("publishWrite");
    if (!session.ok) return session;
    const { supabase, user } = session;

    const { count, error: countError } = await supabase
      .from("publish_destinations")
      .select("id", { count: "exact", head: true })
      .eq("kind", "discord");
    if (countError) {
      log.error("publish.destination_count_failed", { code: countError.code });
      return fail("server_error");
    }
    if ((count ?? 0) >= DESTINATION_LIMITS.maxDiscord) return fail("too_many_destinations");

    // As the user: RLS refuses guests, the CHECK constraint refuses any other URL shape.
    const { error } = await supabase.from("publish_destinations").insert({
      user_id: user.id,
      kind: "discord",
      label: parsed.data.label,
      config: { webhook_url: webhookUrl },
    });
    if (error) {
      // The code only: the row that failed contains the webhook URL.
      log.error("publish.destination_insert_failed", { code: error.code });
      return fail(error.code === "23514" ? "invalid_webhook_url" : "server_error");
    }

    revalidatePath("/app/settings");
    return { ok: true };
  } catch (error) {
    threw("publish.destination_add_threw", error);
    return fail("server_error");
  }
}

/** Removes a destination. Its jobs go with it (ON DELETE CASCADE). */
export async function removeDestinationAction(input: unknown): Promise<DestinationResult> {
  const parsed = destinationIdSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");

  try {
    const session = await begin("publishWrite");
    if (!session.ok) return session;

    const { data, error } = await session.supabase
      .from("publish_destinations")
      .delete()
      .eq("id", parsed.data.id)
      .eq("kind", "discord")
      .select("id");
    if (error) {
      log.error("publish.destination_delete_failed", { code: error.code });
      return fail("server_error");
    }
    if (!data || data.length === 0) return fail("destination_not_found");

    revalidatePath("/app/settings");
    revalidatePath("/app/calendar");
    return { ok: true };
  } catch (error) {
    threw("publish.destination_remove_threw", error);
    return fail("server_error");
  }
}

export type TestResult = { ok: true; simulated: boolean } | Failure;

/**
 * "Send test message" for a Discord destination. On a deployment without n8n
 * nothing is sent and the result says so (`simulated`).
 */
export async function testDestinationAction(input: unknown): Promise<TestResult> {
  const parsed = destinationIdSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");

  try {
    const session = await begin("destinationTest");
    if (!session.ok) return session;

    const { data, error } = await session.supabase
      .from("publish_destinations")
      .select("kind, config")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (error) {
      log.error("publish.destination_test_lookup_failed", { code: error.code });
      return fail("server_error");
    }
    const webhookUrl = (data?.config as { webhook_url?: unknown } | null)?.webhook_url;
    if (!data || data.kind !== "discord" || !isDiscordWebhookUrl(webhookUrl)) {
      return fail("destination_not_found");
    }

    if (publishMode() === "simulated") return { ok: true, simulated: true };

    const t = await getTranslations("publish.destinations");
    const result = await sendDiscordMessage(webhookUrl, t("testMessage"));
    if (!result.ok) {
      log.warn("publish.destination_test_failed", { httpStatus: result.httpStatus });
      return fail("test_failed");
    }
    return { ok: true, simulated: false };
  } catch (error) {
    threw("publish.destination_test_threw", error);
    return fail("server_error");
  }
}
