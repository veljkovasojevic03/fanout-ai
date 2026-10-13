import type { Metadata } from "next";
import { getFormatter, getNow, getTranslations } from "next-intl/server";

import { BillingSection } from "@/components/billing/billing-section";
import { DestinationsSection } from "@/components/publish/destinations-section";
import { ProfileForm } from "@/components/settings/profile-form";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMeter } from "@/components/ui/usage-meter";
import { getAppContext, nextResetDate } from "@/lib/auth/session";
import { getBillingState, getPlanCatalog } from "@/lib/billing/server";
import { publishMode } from "@/lib/publish/dispatcher";
import { listDestinations } from "@/lib/publish/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  const context = await getAppContext("/app/settings");
  if (!context) return null;

  const { user, account, guest } = context;
  const { profile, limit, usage } = account;
  const [t, format, now, params, billing, catalog, destinations] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getNow(),
    searchParams,
    getBillingState(),
    getPlanCatalog(),
    // Guests cannot have destinations; there is nothing to load for them.
    guest ? [] : listDestinations(),
  ]);

  // Set by Stripe's return URLs. It only chooses which notice to show.
  const returned =
    params.billing === "success" || params.billing === "cancelled" ? params.billing : null;

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.profile.title")}</CardTitle>
            <CardDescription>{t("settings.profile.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              email={guest ? null : (user.email ?? null)}
              initial={{
                display_name: profile.display_name ?? "",
                ui_language: profile.ui_language,
                default_content_language: profile.default_content_language,
                default_tone: profile.default_tone,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.usage.title")}</CardTitle>
            <CardDescription>{t("settings.usage.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <UsageMeter
              used={usage.generations}
              limit={limit.generations}
              label={t("shell.usage.meter", {
                used: usage.generations,
                limit: limit.generations,
              })}
            />
            <dl>
              <Stat label={t("settings.usage.plan")}>
                <Badge variant={profile.plan === "pro" ? "solid" : "neutral"}>
                  {t(`common.plans.${profile.plan}`)}
                </Badge>
              </Stat>
              <Stat
                label={
                  limit.period === "lifetime"
                    ? t("settings.usage.generationsLifetime")
                    : t("settings.usage.generationsMonth")
                }
              >
                <span className="counter">
                  {t("settings.usage.generationsValue", {
                    used: format.number(usage.generations),
                    limit: format.number(limit.generations),
                  })}
                </span>
              </Stat>
              <Stat label={t("settings.usage.wordsPeriod")}>
                <span className="counter">{format.number(usage.words)}</span>
              </Stat>
              <Stat label={t("settings.usage.generationsAllTime")}>
                <span className="counter">{format.number(usage.totalGenerations)}</span>
              </Stat>
              <Stat label={t("settings.usage.wordsAllTime")}>
                <span className="counter">{format.number(usage.totalWords)}</span>
              </Stat>
              <Stat label={t("settings.usage.lengths")}>
                {t("settings.usage.lengthsUpTo", {
                  length: t(`common.lengths.${limit.max_length}`),
                })}
              </Stat>
              <Stat label={t("settings.usage.resets")}>
                {limit.period === "lifetime"
                  ? t("settings.usage.resetsNever")
                  : format.dateTime(nextResetDate(now), {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      // The allowance resets at the UTC month boundary.
                      timeZone: "UTC",
                    })}
              </Stat>
            </dl>
          </CardContent>
        </Card>

        <DestinationsSection
          guest={guest}
          email={guest ? null : (user.email ?? null)}
          emailVerified={Boolean(user.email && user.email_confirmed_at)}
          destinations={destinations}
          mode={publishMode()}
        />

        <BillingSection
          plan={profile.plan}
          guest={guest}
          billing={billing}
          catalog={catalog}
          returned={returned}
        />
      </div>
    </>
  );
}
