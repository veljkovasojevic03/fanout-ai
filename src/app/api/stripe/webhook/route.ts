import { apiError, apiOk } from "@/lib/api/response";
import { getStripe, getStripeConfig } from "@/lib/billing/stripe";
import {
  processStripeEvent,
  type ApplyOutcome,
  type StripeEventLike,
  type WebhookDeps,
} from "@/lib/billing/webhook";
import { log } from "@/lib/log";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const OUTCOMES: readonly ApplyOutcome[] = ["applied", "duplicate", "ignored", "no_user"];

/**
 * POST /api/stripe/webhook — the single source of truth for plan state
 * (spec §4.7, §5.10).
 *
 *   1. The signature is verified on the RAW body (`request.text()`), before
 *      the JSON is looked at. No valid signature, no effect: this is the only
 *      way into `apply_stripe_event()`.
 *   2. Events are idempotent through `stripe_events`.
 *   3. The plan is derived from the subscription status, in the database.
 *
 * Responses: 400 for a bad signature (Stripe will not retry a 4xx forever),
 * 5xx when our side failed (Stripe retries), 200 otherwise — including for
 * events that are not ours to handle.
 */
export async function POST(request: Request) {
  const config = getStripeConfig();
  const stripe = getStripe(config);
  if (!stripe || !config.webhookSecret || !isSupabaseAdminConfigured()) {
    return apiError("not_configured", "Billing is not set up on this deployment.", 503, NO_STORE);
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();

  let event: StripeEventLike & { livemode?: boolean };
  try {
    if (!signature) throw new Error("missing signature");
    event = await stripe.webhooks.constructEventAsync(payload, signature, config.webhookSecret);
  } catch {
    log.warn("stripe.webhook_rejected", { hasSignature: Boolean(signature) });
    return apiError("invalid_signature", "The webhook signature is not valid.", 400, NO_STORE);
  }

  // Test mode only (spec §2). Acknowledged so Stripe stops retrying, but never applied.
  if (event.livemode === true) {
    log.error("stripe.live_event_ignored", { type: event.type });
    return apiOk({ received: true, outcome: "ignored" }, NO_STORE);
  }

  const admin = createSupabaseAdminClient();
  const deps: WebhookDeps = {
    async alreadyProcessed(eventId) {
      const { data, error } = await admin
        .from("stripe_events")
        .select("id")
        .eq("id", eventId)
        .maybeSingle();
      if (error) throw new Error(`stripe_events lookup failed: ${error.code}`);
      return data !== null;
    },
    retrieveSubscription: (subscriptionId) => stripe.subscriptions.retrieve(subscriptionId),
    async apply(input) {
      const { data, error } = await admin.rpc("apply_stripe_event", {
        p_event_id: input.eventId,
        p_event_type: input.eventType,
        p_customer: input.customerId,
        p_user: input.userId,
        p_subscription: input.subscriptionId,
        p_status: input.status,
        p_period_end: input.periodEnd?.toISOString() ?? null,
        p_cancel_at_period_end: input.cancelAtPeriodEnd,
      });
      if (error) throw new Error(`apply_stripe_event failed: ${error.code}`);
      const outcome = OUTCOMES.find((candidate) => candidate === data);
      if (!outcome) throw new Error("apply_stripe_event returned an unknown outcome");
      return outcome;
    },
  };

  try {
    const outcome = await processStripeEvent(event, deps);
    // Ids and codes only. `no_user` means a paid subscription we cannot place: worth an error.
    if (outcome === "no_user") log.error("stripe.event_no_user", { type: event.type });
    else if (outcome !== "unhandled") log.warn("stripe.event", { type: event.type, outcome });
    return apiOk({ received: true, outcome }, NO_STORE);
  } catch (error) {
    log.error("stripe.event_failed", {
      type: event.type,
      name: error instanceof Error ? error.name : "unknown",
    });
    return apiError("server_error", "The event could not be processed.", 500, NO_STORE);
  }
}
