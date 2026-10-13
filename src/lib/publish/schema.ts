import { z } from "zod";

import { APP_LOCALES } from "@/i18n/config";
import { CONTENT_TYPES } from "@/lib/presets";

import { DESTINATION_KINDS, destinationRefSchema, type DestinationView } from "./destinations";
import { CALLBACK_ERROR_CODES } from "./errors";
import type { ClaimedJob } from "./run";

/* Shapes of publishing rows, requests and the n8n callback. */

export const JOB_STATUSES = [
  "scheduled",
  "processing",
  "published",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const PUBLISH_LIMITS = {
  /** Open (scheduled or processing) jobs per user. */
  maxOpenJobs: 50,
  /** Attempts per job, the first one included. */
  maxAttempts: 5,
  /** How far ahead something can be scheduled. Matches the SQL default. */
  maxAheadDays: 366,
  /** A time this far in the past is still read as "now" (clock skew, a slow click). */
  pastGraceMs: 60_000,
} as const;

/** `publish` request: `scheduledAt` null means "publish now". */
export const publishRequestSchema = z.object({
  contentId: z.uuid(),
  destination: destinationRefSchema,
  scheduledAt: z.iso.datetime().nullable(),
});
export type PublishRequest = z.infer<typeof publishRequestSchema>;

/** Reschedule and/or move to another destination. At least one of the two. */
export const jobUpdateSchema = z
  .object({
    jobId: z.uuid(),
    scheduledAt: z.iso.datetime().nullable(),
    destination: destinationRefSchema.nullable(),
  })
  .refine((value) => value.scheduledAt !== null || value.destination !== null);

export const jobIdSchema = z.object({ jobId: z.uuid() });
export const destinationIdSchema = z.object({ id: z.uuid() });

/** Why a requested time is not acceptable, or null when it is. */
export function checkScheduledAt(scheduledAt: Date, now: Date = new Date()): "invalid_time" | null {
  const time = scheduledAt.getTime();
  if (!Number.isFinite(time)) return "invalid_time";
  if (time < now.getTime() - PUBLISH_LIMITS.pastGraceMs) return "invalid_time";
  if (time > now.getTime() + PUBLISH_LIMITS.maxAheadDays * 86_400_000) return "invalid_time";
  return null;
}

/* ---- what the UI reads ---- */

const attemptRowSchema = z.object({
  id: z.uuid(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  ok: z.boolean().nullable(),
  detail: z.string().nullable(),
});

export const jobRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(JOB_STATUSES),
  scheduled_at: z.string(),
  published_at: z.string().nullable(),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  simulated: z.boolean(),
  contents: z.object({ id: z.uuid(), title: z.string(), type: z.enum(CONTENT_TYPES) }),
  publish_destinations: z.object({
    id: z.uuid(),
    kind: z.enum(DESTINATION_KINDS),
    label: z.string(),
  }),
  publish_attempts: z.array(attemptRowSchema),
});

export type AttemptView = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  /** null while the attempt is still running. */
  ok: boolean | null;
  detail: string | null;
};

/** A publish job as the calendar shows it. Plain data, so `/design` can fake it. */
export type JobView = {
  id: string;
  status: JobStatus;
  scheduledAt: string;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
  simulated: boolean;
  content: { id: string; title: string; type: (typeof CONTENT_TYPES)[number] };
  destination: Pick<DestinationView, "id" | "kind" | "label">;
  attemptsLog: AttemptView[];
};

export function toJobView(row: z.infer<typeof jobRowSchema>): JobView {
  return {
    id: row.id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    attempts: row.attempts,
    lastError: row.last_error,
    simulated: row.simulated,
    content: row.contents,
    destination: row.publish_destinations,
    attemptsLog: row.publish_attempts
      .map((attempt) => ({
        id: attempt.id,
        startedAt: attempt.started_at,
        finishedAt: attempt.finished_at,
        ok: attempt.ok,
        detail: attempt.detail,
      }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  };
}

/* ---- what the server reads back from the claim functions ---- */

const claimedRowSchema = z.object({
  job_id: z.uuid(),
  attempt_id: z.uuid(),
  user_id: z.uuid(),
  attempt: z.number().int(),
  content_type: z.enum(CONTENT_TYPES),
  content_title: z.string(),
  content_body: z.string(),
  content_language: z.enum(APP_LOCALES),
  destination_kind: z.enum(DESTINATION_KINDS),
  destination_config: z.record(z.string(), z.unknown()),
});

export function parseClaimedJobs(data: unknown): ClaimedJob[] {
  return z
    .array(claimedRowSchema)
    .parse(data ?? [])
    .map((row) => ({
      jobId: row.job_id,
      attemptId: row.attempt_id,
      userId: row.user_id,
      attempt: row.attempt,
      content: {
        type: row.content_type,
        title: row.content_title,
        body: row.content_body,
        language: row.content_language,
      },
      destination:
        row.destination_kind === "email"
          ? { kind: "email" }
          : { kind: "discord", webhookUrl: z.string().parse(row.destination_config.webhook_url) },
    }));
}

/* ---- the n8n callback ---- */

/** The largest callback body that is even looked at. A real one is ~200 bytes. */
export const CALLBACK_MAX_BYTES = 4096;

export const callbackSchema = z.object({
  jobId: z.uuid(),
  attemptId: z.uuid(),
  ok: z.boolean(),
  /** Why it failed. Anything n8n might add that is not on the list is ignored. */
  error: z.enum(CALLBACK_ERROR_CODES).optional().catch(undefined),
  /** The destination's HTTP status, when there was one. */
  httpStatus: z.number().int().min(100).max(599).optional().catch(undefined),
});
export type PublishCallback = z.infer<typeof callbackSchema>;
