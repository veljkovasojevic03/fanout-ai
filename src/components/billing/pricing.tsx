import { Check } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PAID_PLANS, PRO_PRICE, type PaidPlan, type PlanSummary } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

type PricingProps = {
  /** What each plan includes — from `plan_limits`, so the cards match what is enforced. */
  catalog: Record<PaidPlan, PlanSummary>;
  /** Marks one card as the viewer's current plan. */
  current?: PaidPlan | null;
  /** Button (or note) under each plan's feature list. */
  actions?: Partial<Record<PaidPlan, React.ReactNode>>;
  className?: string;
};

/**
 * The Free and Pro plan cards (spec §4.6). Shared by Settings → Billing and
 * the landing page; it knows nothing about the viewer beyond `current`.
 */
export function Pricing({ catalog, current = null, actions = {}, className }: PricingProps) {
  const t = useTranslations();
  const format = useFormatter();

  const price = (amount: number) =>
    format.number(amount, {
      style: "currency",
      currency: PRO_PRICE.currency,
      maximumFractionDigits: 0,
    });

  const features = (plan: PaidPlan): string[] => [
    t("billing.pricing.features.generations", { count: catalog[plan].generations }),
    t("billing.pricing.features.formats"),
    catalog[plan].maxLength === "long"
      ? t("billing.pricing.features.lengthsAll")
      : t("billing.pricing.features.lengthsUpTo", {
          length: t(`common.lengths.${catalog[plan].maxLength}`),
        }),
    t(plan === "pro" ? "billing.pricing.features.modelPro" : "billing.pricing.features.modelFree"),
    t("billing.pricing.features.library"),
  ];

  return (
    <ul
      aria-label={t("billing.pricing.label")}
      className={cn("grid gap-4 md:grid-cols-2", className)}
    >
      {PAID_PLANS.map((plan) => (
        <li key={plan} className="flex">
          <Card
            variant={plan === "pro" ? "accent" : "default"}
            className="flex w-full flex-col gap-5 p-5"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold">{t(`common.plans.${plan}`)}</h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {current === plan ? (
                    <Badge variant="accent">{t("billing.pricing.current")}</Badge>
                  ) : null}
                  {plan === "pro" ? <Badge variant="warn">{t("billing.testMode")}</Badge> : null}
                </div>
              </div>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">
                  {price(plan === "pro" ? PRO_PRICE.amount : 0)}
                </span>
                <span className="text-sm text-muted">{t("billing.pricing.perMonth")}</span>
              </p>
              <p className="text-sm leading-relaxed text-muted">
                {t(`billing.pricing.taglines.${plan}`)}
              </p>
            </div>

            <ul className="flex flex-col gap-2 text-sm">
              {features(plan).map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      plan === "pro" ? "text-accent" : "text-muted",
                    )}
                  />
                  {feature}
                </li>
              ))}
            </ul>

            {actions[plan] ? (
              <div className="mt-auto flex flex-col gap-2">{actions[plan]}</div>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
