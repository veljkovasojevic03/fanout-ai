import { ArrowLeft, Wand } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAppContext } from "@/lib/auth/session";
import { clampLength, isPresetId, PRESETS } from "@/lib/presets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("generate");
  return { title: t("metaTitle") };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border py-3.5 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-40 shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/*
 * The generator form itself is Phase 3. What is real today: a dashboard preset
 * arrives as `?preset=<id>`, is validated, combined with the user's own defaults
 * and plan limits, and shown here exactly as it will prefill the form.
 */
export default async function GeneratePage({ searchParams }: PageProps<"/app/generate">) {
  const context = await getAppContext("/app/generate");
  if (!context) return null;

  const [t, params] = await Promise.all([getTranslations(), searchParams]);
  const presetId = isPresetId(params.preset) ? params.preset : null;
  const { profile, limit } = context.account;

  return (
    <>
      <PageHeader
        title={t("generate.title")}
        description={t("generate.description")}
        aside={<Badge variant="warn">{t("common.notBuiltYet")}</Badge>}
      />

      {presetId ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t(`dashboard.presets.items.${presetId}.title`)}</CardTitle>
              <Badge variant="accent">{t("generate.presetLoaded")}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t("generate.fields.topic")}>
                {t(`dashboard.presets.items.${presetId}.topic`)}
              </Row>
              <Row label={t("generate.fields.tone")}>
                {t(`common.tones.${PRESETS[presetId].tone}`)}
              </Row>
              <Row label={t("generate.fields.length")}>
                {t(`common.lengths.${clampLength(PRESETS[presetId].length, limit.max_length)}`)}
              </Row>
              <Row label={t("generate.fields.language")}>
                {t(`common.languages.${profile.default_content_language}`)}
              </Row>
              <Row label={t("generate.fields.formats")}>
                <span className="flex flex-wrap gap-1.5">
                  {PRESETS[presetId].types.map((type) => (
                    <Badge key={type}>{t(`common.formats.${type}`)}</Badge>
                  ))}
                </span>
              </Row>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<Wand />}
          title={t("generate.noPresetTitle")}
          description={t("generate.noPresetDescription")}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app">
                <ArrowLeft aria-hidden="true" />
                {t("generate.backToDashboard")}
              </Link>
            </Button>
          }
        />
      )}
    </>
  );
}
