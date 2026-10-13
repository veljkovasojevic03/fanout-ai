import type { Metadata } from "next";

import { BillingReturnNotice } from "@/components/billing/billing-actions";
import { BillingSection, type BillingView } from "@/components/billing/billing-section";
import { Pricing } from "@/components/billing/pricing";
import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/lib/auth/session";
import { PLAN_DEFAULTS } from "@/lib/billing/plans";

// Internal preview of the Phase 5 components in every state — no session, no
// database and no Stripe needed. The buttons call the real routes, which answer
// with the signed-out error here.
export const metadata: Metadata = {
  title: "Billing preview",
  robots: { index: false, follow: false },
};

const IN_THREE_WEEKS = new Date(Date.now() + 21 * 86_400_000);

const base: BillingView = {
  hasCustomer: false,
  status: null,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  checkoutAvailable: true,
};

const STATES: {
  title: string;
  note: string;
  plan: Plan;
  guest?: boolean;
  billing: BillingView | null;
}[] = [
  { title: "Free", note: "Never subscribed. Upgrade is offered.", plan: "free", billing: base },
  {
    title: "Pro, renewing",
    note: "status = active",
    plan: "pro",
    billing: { ...base, hasCustomer: true, status: "active", periodEnd: IN_THREE_WEEKS },
  },
  {
    title: "Pro, cancelled at period end",
    note: "status = active, cancel_at_period_end = true",
    plan: "pro",
    billing: {
      ...base,
      hasCustomer: true,
      status: "active",
      periodEnd: IN_THREE_WEEKS,
      cancelAtPeriodEnd: true,
    },
  },
  {
    title: "Payment failed",
    note: "status = past_due → Free until the card is fixed",
    plan: "free",
    billing: { ...base, hasCustomer: true, status: "past_due", periodEnd: IN_THREE_WEEKS },
  },
  {
    title: "Subscription ended",
    note: "status = canceled",
    plan: "free",
    billing: { ...base, hasCustomer: true, status: "canceled" },
  },
  {
    title: "Guest",
    note: "Guests must create an account first.",
    plan: "guest",
    guest: true,
    billing: base,
  },
  {
    title: "Stripe not connected",
    note: "No Stripe keys on the deployment.",
    plan: "free",
    billing: { ...base, checkoutAvailable: false },
  },
  { title: "Load error", note: "The billing query failed.", plan: "free", billing: null },
];

export default function BillingPreviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <Badge variant="accent" className="w-fit">
          Internal
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Billing preview</h1>
        <p className="max-w-2xl leading-relaxed text-muted">
          The pricing cards and Settings → Billing in every subscription state, with sample data.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Pricing</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          The shared plan cards, without actions — as the landing page will use them.
        </p>
        <Pricing catalog={PLAN_DEFAULTS} />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 className="text-xl font-semibold tracking-tight">Return from Checkout</h2>
        <BillingReturnNotice outcome="success" isPro />
        <BillingReturnNotice outcome="cancelled" isPro={false} />
      </section>

      {STATES.map((state, index) => (
        <section key={state.title} className="flex flex-col gap-4 border-t border-border pt-8">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight">{state.title}</h2>
            <p className="font-mono text-xs text-muted">{state.note}</p>
          </div>
          <BillingSection
            id={`billing-${index}`}
            plan={state.plan}
            guest={state.guest ?? false}
            billing={state.billing}
            catalog={PLAN_DEFAULTS}
          />
        </section>
      ))}
    </div>
  );
}
