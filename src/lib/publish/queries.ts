import "server-only";

import { z } from "zod";

import { log } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  DESTINATION_KINDS,
  isDiscordWebhookUrl,
  maskDiscordWebhookUrl,
  type DestinationView,
} from "./destinations";
import { jobRowSchema, toJobView, type JobView } from "./schema";

/*
 * Publishing reads. Every query runs as the signed-in user (anon key +
 * session), so RLS scopes it to their own rows. Each returns null on failure
 * so the page can show an error state.
 */

const threw = (event: string, error: unknown) =>
  log.error(event, { name: error instanceof Error ? error.name : "unknown" });

const destinationRowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DESTINATION_KINDS),
  label: z.string(),
  config: z.record(z.string(), z.unknown()),
});

/**
 * The user's destinations, oldest first. The webhook URL is masked HERE, on
 * the server: once saved, the full URL is never sent to a browser again.
 */
export async function listDestinations(): Promise<DestinationView[] | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("publish_destinations")
      .select("id, kind, label, config")
      .order("created_at", { ascending: true });
    if (error) {
      log.error("publish.destinations_failed", { code: error.code });
      return null;
    }
    return z
      .array(destinationRowSchema)
      .parse(data ?? [])
      .map(({ id, kind, label, config }) => ({
        id,
        kind,
        label,
        hint:
          kind === "discord" && isDiscordWebhookUrl(config.webhook_url)
            ? maskDiscordWebhookUrl(config.webhook_url)
            : null,
      }));
  } catch (error) {
    threw("publish.destinations_threw", error);
    return null;
  }
}

const JOB_SELECT =
  "id, status, scheduled_at, published_at, attempts, last_error, simulated, " +
  "contents(id, title, type), publish_destinations(id, kind, label), " +
  "publish_attempts(id, started_at, finished_at, ok, detail)";

/** More than a month view can sensibly show; also the cap on open jobs times ten. */
const MAX_JOBS_PER_VIEW = 500;

/** Jobs scheduled in `[from, to)`, in order. */
export async function listJobsBetween(from: Date, to: Date): Promise<JobView[] | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("publish_jobs")
      .select(JOB_SELECT)
      .gte("scheduled_at", from.toISOString())
      .lt("scheduled_at", to.toISOString())
      .order("scheduled_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_JOBS_PER_VIEW);
    if (error) {
      log.error("publish.jobs_failed", { code: error.code });
      return null;
    }
    return z
      .array(jobRowSchema)
      .parse(data ?? [])
      .map(toJobView);
  } catch (error) {
    threw("publish.jobs_threw", error);
    return null;
  }
}

/** Failed jobs from any month, newest first — they need a decision wherever the calendar is. */
export async function listFailedJobs(limit = 20): Promise<JobView[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("publish_jobs")
      .select(JOB_SELECT)
      .eq("status", "failed")
      .order("scheduled_at", { ascending: false })
      .limit(limit);
    if (error) {
      log.error("publish.failed_jobs_failed", { code: error.code });
      return [];
    }
    return z
      .array(jobRowSchema)
      .parse(data ?? [])
      .map(toJobView);
  } catch (error) {
    threw("publish.failed_jobs_threw", error);
    return [];
  }
}
