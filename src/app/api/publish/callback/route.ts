import { apiError, apiOk } from "@/lib/api/response";
import { log } from "@/lib/log";
import { getPublishConfig } from "@/lib/publish/dispatcher";
import { formatFailure } from "@/lib/publish/errors";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/publish/hmac";
import { CALLBACK_MAX_BYTES, callbackSchema } from "@/lib/publish/schema";
import { createRunDeps } from "@/lib/publish/server";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/publish/callback — n8n reports how a delivery went (spec §5.9).
 *
 *   1. The HMAC signature is verified on the RAW body, before the JSON is
 *      parsed: no valid signature, no effect. There is no session here.
 *   2. Requests older than five minutes are refused (replay window).
 *   3. The outcome is applied by `finish_publish_attempt()`, which only acts
 *      while the job is still waiting for exactly this attempt — so a replay
 *      inside the window, or a late answer, changes nothing ('stale').
 *
 * Responses: 401 for a bad signature, 400 for a body that is not a callback,
 * 5xx when our side failed (n8n retries), 200 otherwise.
 */
export async function POST(request: Request) {
  const { n8nSecret } = getPublishConfig();
  if (!n8nSecret || !isSupabaseAdminConfigured()) {
    return apiError("not_configured", "Publishing callbacks are not set up.", 503, NO_STORE);
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > CALLBACK_MAX_BYTES) {
    return apiError("invalid_input", "The callback body is too large.", 413, NO_STORE);
  }

  const check = verifySignature({
    secret: n8nSecret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    body,
  });
  if (!check.ok) {
    log.warn("publish.callback_rejected", { reason: check.reason });
    return apiError("invalid_signature", "The callback signature is not valid.", 401, NO_STORE);
  }

  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Falls through to the schema check below.
  }
  const parsed = callbackSchema.safeParse(json);
  if (!parsed.success) {
    return apiError("invalid_input", "The callback body is not valid.", 400, NO_STORE);
  }
  const { jobId, attemptId, ok, error, httpStatus } = parsed.data;

  try {
    const outcome = await createRunDeps(createSupabaseAdminClient()).finish({
      jobId,
      attemptId,
      ok,
      detail: ok ? null : formatFailure(error ?? "delivery_failed", httpStatus),
      // A callback only ever comes from a real delivery.
      simulated: false,
    });
    log.warn("publish.callback", { jobId, ok, outcome });
    return apiOk({ received: true, outcome }, NO_STORE);
  } catch (caught) {
    log.error("publish.callback_failed", {
      jobId,
      name: caught instanceof Error ? caught.name : "unknown",
    });
    return apiError("server_error", "The callback could not be processed.", 500, NO_STORE);
  }
}
