import { apiError, apiOk } from "@/lib/api/response";
import { log } from "@/lib/log";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

// Always run on request: a cached "ok" would defeat the purpose of a health check.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const DB_TIMEOUT_MS = 5000;

/**
 * GET /api/health — runs a real, cheap query against Postgres (three-row table,
 * primary-key lookup). Returns 200 only if the database actually answered.
 * Used by uptime checks and, later, to detect a paused Supabase project.
 */
export async function GET() {
  if (!isSupabaseAdminConfigured()) {
    return apiError("not_configured", "Database credentials are not set.", 503, NO_STORE);
  }

  const startedAt = performance.now();

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("plan_limits")
      .select("plan")
      .eq("plan", "free")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();

    if (error || !data) {
      // error.code is a PostgREST/Postgres code (e.g. 42P01 when migrations are missing).
      log.error("health.db_failed", { code: error?.code ?? "no_rows" });
      return apiError(
        "db_unavailable",
        "The database did not answer the health query.",
        503,
        NO_STORE,
      );
    }
  } catch (error) {
    log.error("health.db_threw", { name: error instanceof Error ? error.name : "unknown" });
    return apiError("db_unavailable", "The database could not be reached.", 503, NO_STORE);
  }

  return apiOk(
    { status: "ok", db: "ok", latencyMs: Math.round(performance.now() - startedAt) },
    NO_STORE,
  );
}
