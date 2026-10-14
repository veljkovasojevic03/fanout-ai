import {
  ArrowRight,
  CalendarClock,
  FileDown,
  FlaskConical,
  Languages,
  CodeXml,
  Link2,
  PenLine,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand/wordmark";
import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONTENT_TYPES } from "@/lib/presets";
import { GITHUB_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

import { Reveal } from "./reveal";
import { SpotlightCard } from "./spotlight-card";

/*
 * The landing page's static sections. Server-rendered (no client JavaScript of
 * their own) except for the small Reveal / SpotlightCard / Accordion islands.
 */

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
      <p className="font-mono text-xs tracking-wider text-accent uppercase">{eyebrow}</p>
      <h2 id={id} className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
        {title}
      </h2>
      {description ? <p className="leading-relaxed text-muted">{description}</p> : null}
    </div>
  );
}

type Feature = {
  key:
    "parallel" | "sample" | "editor" | "library" | "publish" | "bilingual" | "repurpose" | "secure";
  icon: LucideIcon;
  className: string;
};

// A 6-column bento on desktop; one column on phones, two on tablets.
const FEATURES: readonly Feature[] = [
  { key: "parallel", icon: Sparkles, className: "md:col-span-2 lg:col-span-4 lg:row-span-2" },
  { key: "sample", icon: FlaskConical, className: "lg:col-span-2" },
  { key: "editor", icon: PenLine, className: "lg:col-span-2" },
  { key: "publish", icon: CalendarClock, className: "lg:col-span-2" },
  { key: "library", icon: FileDown, className: "lg:col-span-2" },
  { key: "bilingual", icon: Languages, className: "lg:col-span-2" },
  { key: "repurpose", icon: Link2, className: "lg:col-span-2" },
  { key: "secure", icon: ShieldCheck, className: "md:col-span-2 lg:col-span-4" },
];

// Widths of the "streaming" bars in the large card; decorative.
const BAR_WIDTHS = ["w-11/12", "w-3/4", "w-5/6", "w-2/3", "w-4/5"];

export function FeaturesSection() {
  const t = useTranslations("landing.features");
  const tc = useTranslations("common");

  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-24">
      <Reveal>
        <SectionHeading
          id="features-title"
          eyebrow={t("eyebrow")}
          title={t("title")}
          description={t("description")}
        />
      </Reveal>

      <ul className="mt-12 grid auto-rows-fr gap-4 md:grid-cols-2 lg:grid-cols-6">
        {FEATURES.map(({ key, icon: Icon, className }, index) => (
          <li key={key} className={cn("flex", className)}>
            <Reveal delay={(index % 3) * 80} className="flex w-full">
              <SpotlightCard className="w-full">
                <div className="flex h-full flex-col gap-3 p-5 sm:p-6">
                  <span
                    aria-hidden="true"
                    className="flex size-9 items-center justify-center rounded-md border border-accent-ring bg-accent-soft text-accent [&_svg]:size-4"
                  >
                    <Icon />
                  </span>
                  <h3 className="text-[15px] font-semibold">{t(`items.${key}.title`)}</h3>
                  <p className="text-sm leading-relaxed text-muted">{t(`items.${key}.body`)}</p>

                  {key === "parallel" ? (
                    <div aria-hidden="true" className="mt-auto grid gap-2 pt-4 sm:grid-cols-2">
                      {CONTENT_TYPES.map((type, row) => (
                        <div
                          key={type}
                          className={cn(
                            "flex flex-col gap-2 rounded-lg border border-border bg-background/50 p-3",
                            type === "blog" && "sm:col-span-2",
                          )}
                        >
                          <span className="flex items-center gap-2 text-xs text-muted">
                            <ContentTypeIcon type={type} className="size-3.5" />
                            {tc(`formats.${type}`)}
                          </span>
                          <span
                            className={cn(
                              "relative h-1.5 overflow-hidden rounded-full bg-border-strong",
                              BAR_WIDTHS[row],
                            )}
                          >
                            {/* A moving highlight: transform only, so it runs on the compositor. */}
                            <span
                              className="absolute inset-y-0 left-0 w-1/2 animate-sweep bg-[linear-gradient(90deg,transparent,var(--accent-ring),transparent)]"
                              style={{ animationDelay: `${row * 0.25}s` }}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </SpotlightCard>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEPS = ["idea", "stream", "publish"] as const;

export function HowItWorksSection() {
  const t = useTranslations("landing.how");

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24">
      <Reveal>
        <SectionHeading id="how-title" eyebrow={t("eyebrow")} title={t("title")} />
      </Reveal>
      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex">
            <Reveal delay={index * 100} className="flex w-full">
              <div className="relative flex w-full flex-col gap-3 rounded-xl border border-border bg-surface/60 p-6">
                <span
                  aria-hidden="true"
                  className="counter text-4xl font-semibold text-accent/80 [text-shadow:0_0_24px_var(--accent-ring)]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="text-[15px] font-semibold">{t(`steps.${step}.title`)}</h3>
                <p className="text-sm leading-relaxed text-muted">{t(`steps.${step}.body`)}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

const FAQ = [
  "free",
  "account",
  "sample",
  "ai",
  "billing",
  "serbian",
  "publishing",
  "data",
] as const;

export function FaqSection() {
  const t = useTranslations("landing.faq");

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
      <Reveal>
        <SectionHeading id="faq-title" eyebrow={t("eyebrow")} title={t("title")} />
      </Reveal>
      <Reveal className="mx-auto mt-10 max-w-3xl">
        <Accordion
          type="single"
          collapsible
          className="rounded-xl border border-border bg-surface/60 px-5 sm:px-6"
        >
          {FAQ.map((item) => (
            <AccordionItem key={item} value={item}>
              <AccordionTrigger>{t(`items.${item}.question`)}</AccordionTrigger>
              <AccordionContent>{t(`items.${item}.answer`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}

/** Where the main call to action leads: the app for a signed-in visitor, a guest session otherwise. */
export function PrimaryActions({
  signedIn,
  size = "lg",
}: {
  signedIn: boolean;
  size?: "md" | "lg";
}) {
  const t = useTranslations("landing.hero");

  if (signedIn) {
    return (
      <Button asChild size={size}>
        <Link href="/app">
          {t("openApp")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  return (
    <>
      <Button asChild size={size}>
        <Link href="/guest">
          {t("tryGuest")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <Button asChild size={size} variant="secondary">
        <Link href="/signup">{t("signUp")}</Link>
      </Button>
    </>
  );
}

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("landing.cta");

  return (
    <section aria-labelledby="cta-title">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-accent-ring bg-surface px-6 py-14 text-center sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] max-w-full -translate-x-1/2 glow-accent"
          />
          <div className="relative mx-auto flex max-w-xl flex-col items-center gap-5">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              {t("title")}
            </h2>
            <p className="leading-relaxed text-muted">{t("body")}</p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <PrimaryActions signedIn={signedIn} />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

const NAV = [
  { key: "features", href: "#features" },
  { key: "how", href: "#how" },
  { key: "pricing", href: "#pricing" },
  { key: "faq", href: "#faq" },
] as const;

export function SiteFooter() {
  const t = useTranslations("landing");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-3">
          <Wordmark />
          <p className="text-sm text-muted">{t("footer.portfolio")}</p>
          <Badge variant="warn" dot className="w-fit">
            {t("footer.testMode")}
          </Badge>
        </div>
        <nav aria-label={t("nav.label")} className="flex flex-col gap-6 sm:flex-row sm:gap-12">
          <ul className="flex flex-col gap-2 text-sm">
            {NAV.map((item) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  className="rounded-sm text-muted transition-colors hover:text-foreground"
                >
                  {t(`nav.${item.key}`)}
                </a>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link
                href={"/login" as Route}
                className="rounded-sm text-muted transition-colors hover:text-foreground"
              >
                {t("nav.logIn")}
              </Link>
            </li>
            <li>
              <Link
                href="/signup"
                className="rounded-sm text-muted transition-colors hover:text-foreground"
              >
                {t("nav.signUp")}
              </Link>
            </li>
            <li>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-sm text-muted transition-colors hover:text-foreground"
              >
                <CodeXml aria-hidden="true" className="size-4" />
                {t("footer.github")}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function SiteHeader({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children?: React.ReactNode;
}) {
  const t = useTranslations("landing.nav");

  return (
    <header className="sticky top-0 z-30 border-b border-transparent bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        {/* The visible wordmark is the link's name (no aria-label that would differ from it). */}
        <Link href="/" className="inline-flex rounded-sm">
          <Wordmark />
        </Link>
        <nav aria-label={t("label")} className="ml-4 hidden md:block">
          <ul className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-white/[0.05] hover:text-foreground"
                >
                  {t(item.key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {children}
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/app">{t("openApp")}</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
                <Link href={"/login" as Route}>{t("logIn")}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">{t("signUp")}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
