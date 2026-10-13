import type { Dispatcher } from "./dispatcher";
import { buildDelivery, type DeliveryTarget, type PublishContent } from "./render";

/*
 * What happens to a job after it has been claimed, and what one cron tick
 * does. No database and no network in this file: both are passed in, which is
 * what lets the whole flow be unit-tested.
 *
 * By the time a job reaches this code it is already 'processing' in the
 * database (claimed atomically, see the publishing migration), so nothing here
 * can send the same job twice.
 */

/** A job as `claim_publish_job()` / `claim_due_publish_jobs()` return it. */
export type ClaimedJob = {
  jobId: string;
  attemptId: string;
  userId: string;
  attempt: number;
  content: PublishContent;
  destination: { kind: "email" } | { kind: "discord"; webhookUrl: string };
};

export type FinishInput = {
  jobId: string;
  attemptId: string;
  ok: boolean;
  /** A stored failure code, or null on success. */
  detail: string | null;
  simulated: boolean;
};

export type RunDeps = {
  dispatcher: Dispatcher;
  /** The account's own email address, or null when it has none or it is not verified. */
  getVerifiedEmail(userId: string): Promise<string | null>;
  /** Records the outcome. 'stale' = the job was no longer waiting for it. */
  finish(input: FinishInput): Promise<"applied" | "stale">;
};

export type RunOutcome = {
  jobId: string;
  /** 'processing' = handed to n8n; the callback will finish it. */
  status: "published" | "failed" | "processing";
  simulated: boolean;
  error: string | null;
};

export async function runClaimedJob(job: ClaimedJob, deps: RunDeps): Promise<RunOutcome> {
  const { jobId, attemptId } = job;

  const fail = async (error: string): Promise<RunOutcome> => {
    await deps.finish({ jobId, attemptId, ok: false, detail: error, simulated: false });
    return { jobId, status: "failed", simulated: false, error };
  };

  let target: DeliveryTarget;
  try {
    target =
      job.destination.kind === "email"
        ? { kind: "email", to: await deps.getVerifiedEmail(job.userId) }
        : job.destination;
  } catch {
    return fail("dispatch_error");
  }

  const built = buildDelivery(job.content, target);
  if (!built.ok) return fail(built.error);

  let result;
  try {
    result = await deps.dispatcher.dispatch({ jobId, attemptId, delivery: built.delivery });
  } catch {
    return fail("dispatch_error");
  }

  if (result.status === "accepted") {
    return { jobId, status: "processing", simulated: false, error: null };
  }

  await deps.finish({
    jobId,
    attemptId,
    ok: result.ok,
    detail: result.ok ? null : (result.error ?? "delivery_failed"),
    simulated: result.simulated,
  });
  return {
    jobId,
    status: result.ok ? "published" : "failed",
    simulated: result.simulated,
    error: result.ok ? null : (result.error ?? "delivery_failed"),
  };
}

export type TickDeps = RunDeps & {
  /** A real, cheap write-capable query: housekeeping that doubles as the keep-alive. */
  keepAlive(): Promise<number>;
  /** Fails jobs that have been 'processing' for too long; returns how many. */
  failStuck(): Promise<number>;
  /** Atomically moves due jobs to 'processing' and returns them. */
  claimDue(limit: number): Promise<ClaimedJob[]>;
};

export type TickSummary = {
  /** Old rate-limit rows removed by the keep-alive query. */
  pruned: number;
  stuck: number;
  claimed: number;
  published: number;
  failed: number;
  /** Handed to n8n, waiting for its callback. */
  accepted: number;
  /** Jobs whose outcome could not be recorded; the next ticks fail them as stuck. */
  errors: number;
};

export const TICK_BATCH_SIZE = 10;

/**
 * One cron tick (spec Phase 6.5):
 *   (a) keep-alive — a real query, which is also what stops Supabase pausing;
 *   (d) stuck jobs are failed first, so they free their place for a retry;
 *   (b) due jobs are claimed, atomically;
 *   (c) and dispatched, side by side.
 * A failure of (a), (d) or (b) throws: the database is not reachable and the
 * caller answers 5xx. A failure inside one job never stops the others.
 */
export async function runTick(deps: TickDeps, batchSize = TICK_BATCH_SIZE): Promise<TickSummary> {
  const pruned = await deps.keepAlive();
  const stuck = await deps.failStuck();
  const jobs = await deps.claimDue(batchSize);

  const results = await Promise.allSettled(jobs.map((job) => runClaimedJob(job, deps)));

  const summary: TickSummary = {
    pruned,
    stuck,
    claimed: jobs.length,
    published: 0,
    failed: 0,
    accepted: 0,
    errors: 0,
  };
  for (const result of results) {
    if (result.status === "rejected") summary.errors += 1;
    else if (result.value.status === "published") summary.published += 1;
    else if (result.value.status === "failed") summary.failed += 1;
    else summary.accepted += 1;
  }
  return summary;
}
