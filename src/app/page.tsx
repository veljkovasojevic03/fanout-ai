import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { Pricing } from "@/components/billing/pricing";
import { HeroDemo, type DemoTopic } from "@/components/landing/hero-demo";
import { Reveal } from "@/components/landing/reveal";
import {
  FaqSection,
  FeaturesSection,
  FinalCta,
  HowItWorksSection,
  PrimaryActions,
  SectionHeading,
  SiteFooter,
  SiteHeader,
} from "@/components/landing/sections";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toAppLocale, type AppLocale } from "@/i18n/config";
import { SIGNED_IN_HEADER } from "@/lib/auth/hint";
import { getPlanCatalog } from "@/lib/billing/server";
import { FIXTURE_IDS } from "@/lib/sample";

const OG_LOCALE: Record<AppLocale, string> = { en: "en_US", sr: "sr_RS" };

/**
 * Metadata in the visitor's language (spec Phase 7.3). The locale comes from
 * the cookie or Accept-Language, so there is one URL per page; the share image
 * is generated per language by /og.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [t, locale] = await Promise.all([getTranslations("meta"), getLocale()]);
  const language = toAppLocale(locale);
  const image = { url: `/og?lang=${language}`, width: 1200, height: 630, alt: t("ogAlt") };

  return {
    title: { absolute: t("title") },
    description: t("description"),
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: "Fanout AI",
      title: t("title"),
      description: t("description"),
      url: "/",
      locale: OG_LOCALE[language],
      alternateLocale: OG_LOCALE[language === "en" ? "sr" : "en"],
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: [image],
    },
  };
}

/** The landing page (spec §4.9). */
export default async function HomePage() {
  const [t, locale, requestHeaders, catalog] = await Promise.all([
    getTranslations(),
    getLocale(),
    headers(),
    getPlanCatalog(),
  ]);
  const signedIn = requestHeaders.get(SIGNED_IN_HEADER) === "1";

  // The demo topics are the dashboard presets that have hand-written fixtures.
  const topics: DemoTopic[] = FIXTURE_IDS.map((id) => ({
    id,
    label: t(`dashboard.presets.items.${id}.title`),
    topic: t(`dashboard.presets.items.${id}.topic`),
  }));

  const pricingAction = (label: string, primary: boolean) => (
    <Button asChild variant={primary ? "primary" : "secondary"}>
      <Link href={signedIn ? "/app/settings#billing" : "/signup"}>
        {signedIn ? t("landing.pricing.managePlan") : label}
      </Link>
    </Button>
  );

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      {/* Texture and glow: decorative, behind everything, never intercepting the pointer. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-grid"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-noise" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-140px] left-1/2 h-[520px] w-[900px] max-w-[140vw] -translate-x-1/2 glow-accent"
      />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
      >
        {t("common.skipToContent")}
      </a>

      <SiteHeader signedIn={signedIn}>
        <LanguageSwitcher />
      </SiteHeader>

      <main id="main" className="relative">
        <section
          aria-labelledby="hero-title"
          className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pt-14 pb-20 sm:px-6 sm:pt-20"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
            {/* Wraps on phones: the badge's default is a single line. */}
            <Badge
              variant="accent"
              dot
              className="h-auto max-w-full py-1 leading-snug whitespace-normal"
            >
              {t("landing.hero.eyebrow")}
            </Badge>
            {/* Not animated: it is the largest element on screen and must paint at once. */}
            <h1
              id="hero-title"
              className="text-5xl leading-[1.02] font-semibold tracking-[-0.045em] sm:text-7xl"
            >
              {t("common.taglineLead")}
              <br />
              <span className="text-accent [text-shadow:0_0_48px_rgba(182,255,59,0.35)]">
                {t("common.taglineAccent")}
              </span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted">{t("landing.hero.lead")}</p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <PrimaryActions signedIn={signedIn} />
            </div>
            {signedIn ? null : <p className="text-sm text-muted">{t("landing.hero.note")}</p>}
          </div>

          <HeroDemo topics={topics} defaultLanguage={toAppLocale(locale)} />
        </section>

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-28 px-4 pb-24 sm:px-6">
          <FeaturesSection />
          <HowItWorksSection />

          <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-24">
            <Reveal>
              <SectionHeading
                id="pricing-title"
                eyebrow={t("landing.pricing.eyebrow")}
                title={t("landing.pricing.title")}
                description={t("landing.pricing.description")}
              />
            </Reveal>
            <Reveal className="mx-auto mt-12 max-w-3xl">
              <Pricing
                catalog={catalog}
                actions={{
                  free: pricingAction(t("landing.pricing.startFree"), false),
                  pro: pricingAction(t("landing.pricing.getPro"), true),
                }}
              />
            </Reveal>
          </section>

          <FaqSection />
          <FinalCta signedIn={signedIn} />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
