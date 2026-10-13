import "server-only";

import { log } from "@/lib/log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { createDispatcher, getPublishConfig, type PublishConfig } from "./dispatcher";
import type { ClaimedJob, RunDeps, TickDeps } from "./run";
import { parseClaimedJobs } from "./schema";

/*
 * The parts of publishing that talk to the database with the service role.
 * Every status change goes through one of the SQL functions of the publishing
 * migration; this file only calls them.
 *
 * Claimed jobs carry the Discord webhook URL and the piece's text. Neither is
 * ever logged here — only ids, codes and counts.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const FINISH_OUTCOMES = ["applied", "stale"] as const;

export function createRunDeps(
  admin: Admin = createSupabaseAdminClient(),
  config: PublishConfig = getPublishConfig(),
): RunDeps {
  return {
    dispatcher: createDispatcher(config),

    async getVerifiedEmail(userId) {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error) throw new Error(`user lookup failed: ${error.status ?? "unknown"}`);
      const user = data.user;
      // Only the account's own address, and only once its owner has confirmed it.
      return user?.email && user.email_confirmed_at ? user.email : null;
    },

    async finish({ jobId, attemptId, ok, detail, simulated }) {
      const { data, error } = await admin.rpc("finish_publish_attempt", {
        p_job: jobId,
        p_attempt: attemptId,
        p_ok: ok,
        p_detail: detail,
        p_simulated: simulated,
      });
      if (error) throw new Error(`finish_publish_attempt failed: ${error.code}`);
      const outcome = FINISH_OUTCOMES.find((candidate) => candidate === data);
      if (!outcome) throw new Error("finish_publish_attempt returned an unknown outcome");
      if (outcome === "stale") log.warn("publish.finish_stale", { jobId });
      return outcome;
    },
  };
}

export function createTickDeps(
  admin: Admin = createSupabaseAdminClient(),
  config: PublishConfig = getPublishConfig(),
): TickDeps {
  const count = (value: unknown) => (typeof value === "number" ? value : 0);

  return {
    ...createRunDeps(admin, config),

    async keepAlive() {
      const { data, error } = await admin.rpc("prune_rate_limits");
      if (error) throw new Error(`prune_rate_limits failed: ${error.code}`);
      return count(data);
    },

    async failStuck() {
      const { data, error } = await admin.rpc("fail_stuck_publish_jobs");
      if (error) throw new Error(`fail_stuck_publish_jobs failed: ${error.code}`);
      return count(data);
    },

    async claimDue(limit) {
      const { data, error } = await admin.rpc("claim_due_publish_jobs", { p_limit: limit });
      if (error) throw new Error(`claim_due_publish_jobs failed: ${error.code}`);
      return parseClaimedJobs(data);
    },
  };
}

/** Claims one of the user's own due jobs; null when there was nothing to claim. */
export async function claimJob(
  admin: Admin,
  userId: string,
  jobId: string,
): Promise<ClaimedJob | null> {
  const { data, error } = await admin.rpc("claim_publish_job", { p_user: userId, p_job: jobId });
  if (error) throw new Error(`claim_publish_job failed: ${error.code}`);
  return parseClaimedJobs(data)[0] ?? null;
}
