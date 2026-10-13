import { openPortal } from "@/lib/billing/checkout";
import { handleBillingRequest } from "@/lib/billing/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal — opens the Stripe Customer Portal (update card,
 * cancel, resume) for the signed-in user's own customer and answers `{ url }`.
 */
export function POST() {
  return handleBillingRequest("portal", openPortal);
}
