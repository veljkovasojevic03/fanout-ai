import { startCheckout } from "@/lib/billing/checkout";
import { handleBillingRequest } from "@/lib/billing/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout — starts a Stripe Checkout session for Pro and
 * answers `{ url }`. Guests are refused with `guest_not_allowed` (spec §4.1).
 *
 * This cannot make anyone Pro: it only sends the user to Stripe. The plan
 * changes when the signed webhook arrives (POST /api/stripe/webhook).
 */
export function POST() {
  return handleBillingRequest("checkout", startCheckout);
}
