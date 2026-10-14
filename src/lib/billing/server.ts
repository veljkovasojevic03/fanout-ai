import "server-only";

import type { User } from "@supabase/supabase-js";
import { z } from "zod";

import { apiError, apiOk } from "@/lib/api/response";
import { getAppOrigin } from "@/lib/auth/origin";
import { getRequestUser, retryAfter, withinRateLimit } from "@/lib/generation/server";
import { log } from "@/lib/log";
import { LENGTHS } from "@/lib/presets";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { BillingDeps, BillingResult, BillingUser } from "./checkout";
import { BILLING_ERRORS, type BillingErrorCode } from "./errors";
import { PAID_PLANS, PLAN_DEFAULTS, type PaidPlan, type PlanSummary } from "./plans";
import { getStripe, getStripeConfig, isCheckoutConfigured } from "./stripe";

/* The parts of billing that talk to Stripe and the database. */

const NO_STORE = { "Cache-Control": "no-store" };

export function billingError(
  code: Exclude<BillingErrorCode, "network_error">,
  headers?: HeadersInit,
) {
  const spec = BILLING_ERRORS[code];
  return apiError(code, spec.message, spec.status, { ...NO_STORE, ...headers });
}

const profileSchema = z.object({
  plan: z.enum(["guest", "free", "pro"]),
  stripe_customer_id: z.string().nullable(),
});

/** Where Stripe sends the user back to. `billing` tells the settings page what happened. */
const returnUrl = (origin: string, outcome?: "success" | "cancelled") =>
  `${origin}/app/settings${outcome ? `?billing=${outcome}` : ""}#billing`;

/** The real dependencies of `startCheckout` / `openPortal`; null when billing is not set up. */
export async function createBillingDeps(): Promise<BillingDeps | null> {
  const config = getStripeConfig();
  const stripe = getStripe(config);
  if (!stripe || !config.proPriceId || !isSupabaseAdminConfigured()) return null;

  const priceId = config.proPriceId;
  const origin = await getAppOrigin();
  const admin = createSupabaseAdminClient();

  return {
    async getProfile(userId) {
      const { data, error } = await admin
        .from("profiles")
        .select("plan, stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(`profile lookup failed: ${error.code}`);
      if (!data) return null;
      const profile = profileSchema.parse(data);
      return { plan: profile.plan, stripeCustomerId: profile.stripe_customer_id };
    },

    async createCustomer({ id, email }) {
      const customer = await stripe.customers.create(
        { email: email ?? undefined, metadata: { user_id: id } },
        // Two requests racing each other get the same customer back.
        { idempotencyKey: `fanout-customer-${id}` },
      );
      return customer.id;
    },

    async linkCustomer(userId, customerId) {
      const { data, error } = await admin.rpc("link_stripe_customer", {
        p_user: userId,
        p_customer: customerId,
      });
      if (error) throw new Error(`link customer failed: ${error.code}`);
      return typeof data === "string" ? data : null;
    },

    async createCheckoutSession({ userId, customerId }) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        // Both carry OUR user id back in the signed webhook; neither is user input.
        client_reference_id: userId,
        subscription_data: { metadata: { user_id: userId } },
        success_url: returnUrl(origin, "success"),
        cancel_url: returnUrl(origin, "cancelled"),
      });
      return session.url;
    },

    async createPortalSession({ customerId }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl(origin),
      });
      return session.url;
    },
  };
}

const toBillingUser = (user: User): BillingUser => ({
  id: user.id,
  email: user.email ?? null,
  is_anonymous: user.is_anonymous === true,
});

/**
 * Shared body of the two billing routes: authenticate, rate limit, run the
 * action, answer `{ url }` or the standard error shape. Neither route takes
 * any input — everything is derived from the session.
 */
export async function handleBillingRequest(
  name: "checkout" | "portal",
  action: (user: BillingUser, deps: BillingDeps) => Promise<BillingResult>,
): Promise<Response> {
  if (!isSupabaseConfigured()) return billingError("not_configured");

  const user = await getRequestUser();
  if (!user) return billingError("unauthenticated");

  // Said before "not configured": a guest should hear what applies to them.
  if (user.is_anonymous === true) return billingError("guest_not_allowed");

  if (!(await withinRateLimit("billing", user.id))) {
    return billingError("rate_limited", retryAfter("billing"));
  }

  try {
    const deps = await createBillingDeps();
    if (!deps) return billingError("not_configured");

    const result = await action(toBillingUser(user), deps);
    return result.ok ? apiOk({ url: result.url }, NO_STORE) : billingError(result.code);
  } catch (error) {
    // The class of failure only — Stripe messages can contain ids and emails.
    log.error(`billing.${name}_failed`, {
      name: error instanceof Error ? error.name : "unknown",
      type: (error as { type?: unknown } | null)?.type?.toString() ?? null,
    });
    return billingError("server_error");
  }
}

const billingRowSchema = z.object({
  stripe_customer_id: z.string().nullable(),
  subscription_status: z.string().nullable(),
  current_period_end: z.string().nullable(),
  cancel_at_period_end: z.boolean(),
});

export type BillingState = {
  /** True once the user has been through checkout: there is something to manage. */
  hasCustomer: boolean;
  status: string | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** False when this deployment has no Stripe keys: the upgrade button is replaced by a note. */
  checkoutAvailable: boolean;
};

/**
 * What the Billing section shows. Read as the user through RLS; the Stripe
 * customer id itself stays on the server. Returns null if the query fails.
 */
export async function getBillingState(): Promise<BillingState | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("stripe_customer_id, subscription_status, current_period_end, cancel_at_period_end")
      .maybeSingle();
    if (error || !data) {
      log.error("billing.state_failed", { code: error?.code ?? "no_row" });
      return null;
    }
    const row = billingRowSchema.parse(data);
    return {
      hasCustomer: row.stripe_customer_id !== null,
      status: row.subscription_status,
      periodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      checkoutAvailable: isCheckoutConfigured(),
    };
  } catch (error) {
    log.error("billing.state_threw", { name: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

const limitRowSchema = z.object({
  plan: z.enum(["guest", "free", "pro"]),
  generations: z.number().int(),
  max_length: z.enum(LENGTHS),
});

// plan_limits only changes with a migration, so a few minutes of caching per
// server instance is safe — and keeps a database round trip off the landing
// page's critical path.
const CATALOG_TTL_MS = 10 * 60_000;
let cachedCatalog: { value: Record<PaidPlan, PlanSummary>; at: number } | null = null;

/**
 * What each plan includes, from `plan_limits` — the same table the quota
 * function reads, so the pricing cards cannot promise something else. Falls
 * back to the seeded defaults when the table cannot be read (not cached).
 */
export async function getPlanCatalog(): Promise<Record<PaidPlan, PlanSummary>> {
  if (cachedCatalog && Date.now() - cachedCatalog.at < CATALOG_TTL_MS) return cachedCatalog.value;
  return loadPlanCatalog();
}

async function loadPlanCatalog(): Promise<Record<PaidPlan, PlanSummary>> {
  if (!isSupabaseAdminConfigured()) return PLAN_DEFAULTS;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("plan_limits")
      .select("plan, generations, max_length");
    if (error) return PLAN_DEFAULTS;

    const rows = z.array(limitRowSchema).parse(data ?? []);
    const catalog = { ...PLAN_DEFAULTS };
    for (const plan of PAID_PLANS) {
      const row = rows.find((candidate) => candidate.plan === plan);
      if (row) catalog[plan] = { generations: row.generations, maxLength: row.max_length };
    }
    cachedCatalog = { value: catalog, at: Date.now() };
    return catalog;
  } catch {
    return PLAN_DEFAULTS;
  }
}
