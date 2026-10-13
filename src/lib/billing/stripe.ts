import "server-only";

import Stripe from "stripe";

import { log } from "@/lib/log";

/*
 * The Stripe client and its configuration. Server only: the secret key and the
 * webhook secret never leave this module's callers.
 *
 * This deployment is TEST MODE ONLY (spec §2: Vercel Hobby is non-commercial).
 * A live key is refused outright, so a wrong value in the environment cannot
 * turn the demo into something that charges real cards.
 */

export type StripeConfig = {
  secretKey: string | null;
  webhookSecret: string | null;
  proPriceId: string | null;
};

/** `sk_test_…`, or a restricted `rk_test_…` key. */
export const isTestKey = (key: string): boolean => /^(sk|rk)_test_/.test(key);

export function getStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const key = env.STRIPE_SECRET_KEY?.trim() || null;
  if (key && !isTestKey(key)) {
    log.error("billing.live_key_refused", {});
  }
  return {
    secretKey: key && isTestKey(key) ? key : null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    proPriceId: env.STRIPE_PRO_PRICE_ID?.trim() || null,
  };
}

/** True when a user can actually start a checkout on this deployment. */
export function isCheckoutConfigured(config: StripeConfig = getStripeConfig()): boolean {
  return Boolean(config.secretKey && config.proPriceId);
}

// One client per server instance and key.
let cached: { key: string; client: Stripe } | null = null;

export function getStripe(config: StripeConfig = getStripeConfig()): Stripe | null {
  if (!config.secretKey) return null;
  if (cached?.key !== config.secretKey) {
    cached = {
      key: config.secretKey,
      client: new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 10_000 }),
    };
  }
  return cached.client;
}
