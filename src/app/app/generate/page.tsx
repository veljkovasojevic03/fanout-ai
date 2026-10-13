import type { Metadata } from "next";
import { getFormatter, getNow, getTranslations } from "next-intl/server";

import { Generator } from "@/components/generator/generator";
import { PageHeader } from "@/components/shell/page-header";
import { getAppContext, nextResetDate } from "@/lib/auth/session";
import type { GeneratorFormValues } from "@/lib/generation/form";
import { clampLength, CONTENT_TYPES, isPresetId, PRESETS } from "@/lib/presets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("generate");
  return { title: t("metaTitle") };
}

export default async function GeneratePage({ searchParams }: PageProps<"/app/generate">) {
  const context = await getAppContext("/app/generate");
  if (!context) return null;

  const [t, format, now, params] = await Promise.all([
    getTranslations(),
    getFormatter(),
    getNow(),
    searchParams,
  ]);

  const { account, guest } = context;
  const { profile, limit, usage } = account;

  // A dashboard preset arrives as ?preset=<id>. It is validated against the known
  // ids and combined with the user's own defaults and plan limits.
  const presetId = isPresetId(params.preset) ? params.preset : null;
  const preset = presetId ? PRESETS[presetId] : null;

  const initial: GeneratorFormValues = {
    topic: presetId ? t(`dashboard.presets.items.${presetId}.topic`) : "",
    tone: preset?.tone ?? profile.default_tone,
    length: clampLength(preset?.length ?? "medium", limit.max_length),
    contentLanguage: profile.default_content_language,
    keywords: [],
    types: [...(preset?.types ?? CONTENT_TYPES)],
    sourceKind: "none",
    sourceUrl: "",
    sourceText: "",
  };

  return (
    <>
      <PageHeader title={t("generate.title")} description={t("generate.description")} />
      <Generator
        // A different preset is a different starting point: reset the form for it.
        key={presetId ?? "blank"}
        initial={initial}
        plan={profile.plan}
        guest={guest}
        maxLength={limit.max_length}
        remaining={Math.max(limit.generations - usage.generations, 0)}
        resetDate={
          limit.period === "lifetime"
            ? null
            : format.dateTime(nextResetDate(now), {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })
        }
        presetName={presetId ? t(`dashboard.presets.items.${presetId}.title`) : null}
      />
    </>
  );
}
