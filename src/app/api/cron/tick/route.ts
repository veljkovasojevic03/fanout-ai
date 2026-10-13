import { apiError, apiOk } from "@/lib/api/response";
import { log } from "@/lib/log";
import { getPublishConfig } from "@/lib/publish/dispatcher";
import { verifyBearer } from "@/lib/publish/hmac";
import { runTick } from "@/lib/publish/run";
import { createTickDeps } from "@/lib/publish/server";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// One batch is at most ten jobs sent side by side: about a second when
// simulated, a ten-second timeout each towards n8n. Well inside the limit.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/cron/tick — called every five minutes by GitHub Actions
 * (.github/workflows/cron.yml) with `Authorization: Bearer <CRON_SECRET>`.
 *
 *   (a) keep-alive: a real query, which also keeps the free Supabase project
 *       from being paused for inactivity;
 *   (b) claims the jobs that are due, atomically (FOR UPDATE SKIP LOCKED);
 *   (c) dispatches them;
 *   (d) fails jobs that have been 'processing' for more than ten minutes.
 *
 * Safe to call more often, or twice at once: a job can only be claimed once.
 * The response is counts only.
 */
export async function POST(request: Request) {
  const config = getPublishConfig();
  if (!config.cronSecret || !isSupabaseAdminConfigured()) {
    return apiError("not_configured", "The cron endpoint is not set up.", 503, NO_STORE);
  }

  if (!verifyBearer(request.headers.get("authorization"), config.cronSecret)) {
    log.warn("cron.tick_rejected", {});
    return apiError("unauthorized", "The cron secret is not valid.", 401, NO_STORE);
  }

  try {
    const summary = await runTick(createTickDeps(createSupabaseAdminClient(), config));
    if (summary.claimed > 0 || summary.stuck > 0 || summary.errors > 0) {
      log.warn("cron.tick", summary);
    }
    return apiOk({ ok: true, ...summary }, NO_STORE);
  } catch (error) {
    // The database did not answer: the same condition the "waking up" screen shows.
    log.error("cron.tick_failed", { name: error instanceof Error ? error.name : "unknown" });
    return apiError("db_unavailable", "The tick could not reach the database.", 503, NO_STORE);
  }
}
