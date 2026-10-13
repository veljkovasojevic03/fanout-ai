import { ArrowRight, CreditCard } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { FormAlert } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Plan } from "@/lib/auth/session";
import type { PaidPlan, PlanSummary } from "@/lib/billing/plans";

import { BillingButton, BillingReturnNotice } from "./billing-actions";
import { Pricing } from "./pricing";

/** What the section needs to know about the subscription. Plain data, so `/design` can fake it. */
export type BillingView = {
  hasCustomer: boolean;
  status: string | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  checkoutAvailable: boolean;
};

type BillingSectionProps = {
  plan: Plan;
  guest: boolean;
  /** null = the billing details failed to load. */
  billing: BillingView | null;
  catalog: Record<PaidPlan, PlanSummary>;
  /** Set when the user has just come back from Stripe Checkout. */
  returned?: "success" | "cancelled" | null;
  /** Anchor for links such as /app/settings#billing. */
  id?: string;
};

const PAYMENT_PROBLEM = ["past_due", "unpaid", "incomplete"];

/**
 * Settings → Billing (spec Phase 5.5): the current plan, when it renews or
 * ends, and the way to change it. Everything shown comes from `profiles`,
 * which only the verified Stripe webhook writes.
 */
export function BillingSection({
  plan,
  guest,
  billing,
  catalog,
  returned = null,
  id = "billing",
}: BillingSectionProps) {
  const t = useTranslations("billing");
  const format = useFormatter();

  const isGuest = guest || plan === "guest";
  const isPro = plan === "pro";
  const date = billing?.periodEnd
    ? format.dateTime(billing.periodEnd, { day: "numeric", month: "long", year: "numeric" })
    : null;

  let status: string;
  let problem = false;
  if (isGuest) {
    status = t("status.guest");
  } else if (!billing) {
    status = t("status.unavailable");
    problem = true;
  } else if (isPro) {
    status = !date
      ? t("status.proNoDate")
      : billing.cancelAtPeriodEnd
        ? t("status.cancelling", { date })
        : t("status.pro", { date });
  } else if (billing.status && PAYMENT_PROBLEM.includes(billing.status)) {
    status = t("status.paymentFailed");
    problem = true;
  } else if (billing.status === "canceled") {
    status = t("status.ended");
  } else {
    status = t("status.free");
  }

  const manage = (
    <BillingButton action="portal" variant="secondary">
      <CreditCard aria-hidden="true" />
      {t("actions.manage")}
    </BillingButton>
  );

  let proAction: React.ReactNode = null;
  if (isGuest) {
    proAction = (
      <Button asChild>
        <Link href="/app/upgrade">
          {t("actions.createAccount")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  } else if (billing && isPro) {
    proAction = manage;
  } else if (billing && !billing.checkoutAvailable) {
    proAction = <p className="text-[13px] leading-snug text-muted">{t("notConfigured")}</p>;
  } else if (billing) {
    proAction = (
      <>
        <BillingButton action="checkout">{t("actions.upgrade")}</BillingButton>
        <p className="text-[13px] leading-snug text-muted">{t("testCard")}</p>
      </>
    );
  }

  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("title")}</CardTitle>
          <Badge variant="warn">{t("testMode")}</Badge>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {returned && !isGuest ? <BillingReturnNotice outcome={returned} isPro={isPro} /> : null}

        {problem ? (
          <FormAlert tone="error">{status}</FormAlert>
        ) : (
          <p className="text-sm leading-relaxed">{status}</p>
        )}

        {/* A former subscriber keeps access to invoices and can fix a failed card. */}
        {billing && !isPro && !isGuest && billing.hasCustomer ? (
          <div className="flex flex-col items-start gap-2">{manage}</div>
        ) : null}

        <Pricing
          catalog={catalog}
          current={isGuest ? null : isPro ? "pro" : "free"}
          actions={{ pro: proAction }}
        />
      </CardContent>
    </Card>
  );
}
