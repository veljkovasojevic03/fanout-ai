"use client";

import { Sparkles } from "lucide-react";
import { LazyMotion, MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { APP_LOCALES, INTL_LOCALE, type AppLocale } from "@/i18n/config";
import { CONTENT_TYPES } from "@/lib/presets";
import type { FixtureId } from "@/lib/sample";

import { demoCardClass } from "./demo-layout";

export type DemoTopic = {
  id: FixtureId;
  /** Short chip label, e.g. "Product launch". */
  label: string;
  /** The topic sentence the fixture answers. */
  topic: string;
};

const loadFeatures = () => import("./motion-features").then((module) => module.default);
const loadResults = () => import("./demo-results");

// The streaming cards are fetched on the first Generate (or when the pointer
// reaches the button), not with the page.
const DemoResults = dynamic(loadResults, { ssr: false, loading: () => <WaitingCards /> });

type Run = { fixture: FixtureId; language: AppLocale; count: number };

/**
 * The landing page's live demo (spec §4.9): pick a preset topic, press
 * Generate, and all five cards stream in Sample mode — no login, no model
 * call, nothing stored. It talks to the same streaming protocol as the app.
 */
export function HeroDemo({
  topics,
  defaultLanguage,
}: {
  topics: readonly DemoTopic[];
  defaultLanguage: AppLocale;
}) {
  const t = useTranslations();
  const [fixture, setFixture] = useState<FixtureId>(topics[0]!.id);
  const [language, setLanguage] = useState<AppLocale>(defaultLanguage);
  const [run, setRun] = useState<Run | null>(null);

  const selected = topics.find((topic) => topic.id === fixture) ?? topics[0]!;
  const unchanged = run !== null && run.fixture === fixture && run.language === language;

  function generate() {
    setRun((previous) => ({ fixture, language, count: (previous?.count ?? 0) + 1 }));
  }

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        <section
          id="demo"
          aria-labelledby="demo-title"
          className="flex scroll-mt-24 flex-col gap-5 rounded-2xl border border-border-strong bg-surface p-4 shadow-[0_40px_120px_-40px_rgba(182,255,59,0.18)] sm:p-6"
        >
          <div className="flex flex-col gap-1.5">
            <h2 id="demo-title" className="text-lg font-semibold tracking-tight">
              {t("landing.demo.title")}
            </h2>
            <p className="text-sm leading-relaxed text-muted">{t("landing.demo.description")}</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span id="demo-topics" className="text-[13px] font-medium">
                {t("landing.demo.topicsLabel")}
              </span>
              <ToggleGroup
                type="single"
                aria-labelledby="demo-topics"
                value={fixture}
                onValueChange={(value) => (value ? setFixture(value as FixtureId) : undefined)}
              >
                {topics.map((topic) => (
                  <ToggleGroupItem key={topic.id} value={topic.id}>
                    {topic.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              {/* What the demo will write about. Read-only: the demo cannot take free text. */}
              <Field label={t("landing.demo.topicLabel")} className="min-w-0 flex-1">
                <Input readOnly value={selected.topic} className="bg-background/60" />
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <span id="demo-language" className="text-[13px] font-medium">
                    {t("landing.demo.languageLabel")}
                  </span>
                  <ToggleGroup
                    type="single"
                    aria-labelledby="demo-language"
                    value={language}
                    onValueChange={(value) => (value ? setLanguage(value as AppLocale) : undefined)}
                  >
                    {APP_LOCALES.map((locale) => (
                      <ToggleGroupItem key={locale} value={locale} lang={INTL_LOCALE[locale]}>
                        {t(`common.languages.${locale}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <Button
                  size="lg"
                  onClick={generate}
                  onPointerEnter={() => void loadResults()}
                  onFocus={() => void loadResults()}
                  className="w-full sm:ml-auto sm:w-auto"
                >
                  <Sparkles aria-hidden="true" />
                  {unchanged ? t("landing.demo.again") : t("landing.demo.generate")}
                </Button>
              </div>
            </div>

            <p className="text-[13px] leading-snug text-muted">{t("landing.demo.sampleNote")}</p>
          </div>

          <div
            role="region"
            aria-label={t("landing.demo.resultsLabel")}
            className="grid gap-4 lg:grid-cols-2"
          >
            {run ? (
              // A new key restarts all five streams.
              <DemoResults
                key={`${run.fixture}:${run.language}:${run.count}`}
                fixture={run.fixture}
                language={run.language}
              />
            ) : (
              <WaitingCards />
            )}
          </div>
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}

/** Five empty cards with the shape of the real ones, so pressing Generate moves nothing. */
function WaitingCards() {
  const t = useTranslations();
  return (
    <>
      {CONTENT_TYPES.map((type) => (
        <div key={type} className={demoCardClass(type)}>
          <div className="flex w-full flex-col rounded-xl border border-dashed border-border bg-background/40">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
                <ContentTypeIcon type={type} className="size-3.5" />
              </span>
              <h3 className="truncate text-sm font-semibold text-muted">
                {t(`common.formats.${type}`)}
              </h3>
            </div>
            <p className="min-h-36 px-4 py-3.5 text-sm text-muted">{t("landing.demo.idle")}</p>
          </div>
        </div>
      ))}
    </>
  );
}
