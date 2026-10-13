"use client";

import { ArrowRight, Lock, Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { APP_LOCALES, type AppLocale } from "@/i18n/config";
import type { Plan } from "@/lib/auth/session";
import { saveContentAction } from "@/lib/generation/actions";
import { toGenerateErrorCode, type GenerateErrorCode } from "@/lib/generation/errors";
import {
  charCount,
  toGenerateRequest,
  validateForm,
  type FormErrors,
  type GeneratorFormValues,
  type SourceKind,
} from "@/lib/generation/form";
import {
  GENERATION_LIMITS,
  generateResponseSchema,
  type GenerateResponse,
  type StreamMeta,
} from "@/lib/generation/schema";
import {
  allowedLengths,
  CONTENT_TYPES,
  LENGTHS,
  TONES,
  type ContentType,
  type Length,
  type Tone,
} from "@/lib/presets";
import { cn } from "@/lib/utils";

import { KeywordInput } from "./keyword-input";
import { StreamCard } from "./stream-card";
import type { StreamRequestFactory } from "./use-content-stream";

const SOURCE_KINDS: readonly SourceKind[] = ["none", "url", "text"];
const SOURCE_LABEL = { none: "sourceNone", url: "sourceUrl", text: "sourceText" } as const;

type GeneratorProps = {
  initial: GeneratorFormValues;
  plan: Plan;
  guest: boolean;
  maxLength: Length;
  /** Generations left in the current period when the page was rendered. */
  remaining: number;
  /** Already-formatted date the allowance resets on; null for guests. */
  resetDate: string | null;
  /** Name of the preset that prefilled the form, if any. */
  presetName: string | null;
};

type Session = GenerateResponse & { language: AppLocale };

/** The generator: the form, and the cards that stream its results. */
export function Generator({
  initial,
  plan,
  guest,
  maxLength,
  remaining: initialRemaining,
  resetDate,
  presetName,
}: GeneratorProps) {
  const t = useTranslations();
  const router = useRouter();
  const lengthLabelId = useId();
  const resultsRef = useRef<HTMLElement>(null);

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<GenerateErrorCode | null>(null);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [session, setSession] = useState<Session | null>(null);
  const [regenerationsLeft, setRegenerationsLeft] = useState<number>(
    GENERATION_LIMITS.maxRegenerations,
  );

  const set = <K extends keyof GeneratorFormValues>(key: K, value: GeneratorFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    // Editing a field clears its own error; the next submit validates again.
    const errorKey = ERROR_KEY[key];
    if (errorKey) setErrors((current) => ({ ...current, [errorKey]: undefined }));
  };

  const allowed = allowedLengths(maxLength);
  const lockedLength = LENGTHS.find((length) => !allowed.includes(length)) ?? null;
  const exhausted = remaining <= 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || exhausted) return;

    const found = validateForm(values);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    setSubmitting(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toGenerateRequest(values)),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const code = toGenerateErrorCode(
          (body as { error?: { code?: unknown } } | null)?.error?.code,
          "server_error",
        );
        if (code === "quota_exhausted") setRemaining(0);
        else setRequestError(code);
        return;
      }

      const parsed = generateResponseSchema.safeParse(body);
      if (!parsed.success) {
        setRequestError("server_error");
        return;
      }

      setSession({ ...parsed.data, language: values.contentLanguage });
      setRemaining(parsed.data.remaining);
      setRegenerationsLeft(GENERATION_LIMITS.maxRegenerations);
      // Refresh server-rendered usage (top bar meter, dashboard numbers).
      router.refresh();
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch {
      setRequestError("network_error");
    } finally {
      setSubmitting(false);
    }
  }

  const onMeta = useCallback((meta: StreamMeta) => {
    if (meta.regenerationsLeft !== null) setRegenerationsLeft(meta.regenerationsLeft);
  }, []);

  return (
    <div className="flex flex-col gap-10">
      {exhausted ? <QuotaBanner plan={plan} guest={guest} resetDate={resetDate} /> : null}

      <Card>
        <CardContent>
          <form onSubmit={submit} noValidate className="flex flex-col gap-6">
            <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-6">
              <legend className="sr-only">{t("generate.form.legend")}</legend>

              {presetName ? (
                <Badge variant="accent" className="w-fit">
                  {t("generate.form.presetLoaded", { name: presetName })}
                </Badge>
              ) : null}

              <Field
                label={t("generate.form.topic")}
                error={errors.topic ? t(`generate.form.errors.${errors.topic}`) : undefined}
                aside={`${charCount(values.topic)}/${GENERATION_LIMITS.topicMax}`}
              >
                <Textarea
                  rows={2}
                  value={values.topic}
                  onChange={(event) => set("topic", event.target.value)}
                  placeholder={t("generate.form.topicPlaceholder")}
                  className="min-h-16"
                />
              </Field>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span id={`${lengthLabelId}-tone`} className="text-[13px] font-medium">
                    {t("generate.form.tone")}
                  </span>
                  <ToggleGroup
                    type="single"
                    aria-labelledby={`${lengthLabelId}-tone`}
                    value={values.tone}
                    onValueChange={(tone) => tone && set("tone", tone as Tone)}
                  >
                    {TONES.map((tone) => (
                      <ToggleGroupItem key={tone} value={tone}>
                        {t(`common.tones.${tone}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="flex flex-col gap-2">
                  <span id={`${lengthLabelId}-language`} className="text-[13px] font-medium">
                    {t("generate.form.language")}
                  </span>
                  <ToggleGroup
                    type="single"
                    aria-labelledby={`${lengthLabelId}-language`}
                    value={values.contentLanguage}
                    onValueChange={(language) =>
                      language && set("contentLanguage", language as AppLocale)
                    }
                  >
                    {APP_LOCALES.map((language) => (
                      <ToggleGroupItem key={language} value={language}>
                        {t(`common.languages.${language}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <p className="text-[13px] leading-snug text-muted">
                    {t("generate.form.languageHint")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span id={lengthLabelId} className="text-[13px] font-medium">
                    {t("generate.form.length")}
                  </span>
                  <span className="text-[13px] text-accent">
                    {t(`common.lengths.${values.length}`)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={LENGTHS.length - 1}
                  step={1}
                  value={[LENGTHS.indexOf(values.length)]}
                  onValueChange={([index]) => {
                    const next = LENGTHS[index ?? 0]!;
                    // The slider shows every length; the plan decides how far it goes.
                    set("length", allowed.includes(next) ? next : allowed.at(-1)!);
                  }}
                  aria-labelledby={lengthLabelId}
                  aria-valuetext={t(`common.lengths.${values.length}`)}
                />
                <div className="flex justify-between text-xs text-muted" aria-hidden="true">
                  {LENGTHS.map((length) => (
                    <span
                      key={length}
                      className={cn(
                        "flex items-center gap-1",
                        length === values.length && "text-foreground",
                        !allowed.includes(length) && "text-subtle",
                      )}
                    >
                      {allowed.includes(length) ? null : <Lock className="size-3" />}
                      {t(`common.lengths.${length}`)}
                    </span>
                  ))}
                </div>
                {lockedLength ? (
                  <p className="text-[13px] leading-snug text-muted">
                    {t("generate.form.lengthLocked", {
                      length: t(`common.lengths.${lockedLength}`),
                    })}
                  </p>
                ) : null}
              </div>

              <Field
                label={t("generate.form.keywords")}
                hint={t("generate.form.keywordsHint")}
                aside={`${values.keywords.length}/${GENERATION_LIMITS.keywordsMax}`}
              >
                <KeywordInput
                  value={values.keywords}
                  onChange={(keywords) => set("keywords", keywords)}
                  disabled={submitting}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <span id={`${lengthLabelId}-formats`} className="text-[13px] font-medium">
                  {t("generate.form.formats")}
                </span>
                <ToggleGroup
                  type="multiple"
                  aria-labelledby={`${lengthLabelId}-formats`}
                  aria-describedby={`${lengthLabelId}-formats-hint`}
                  value={values.types}
                  onValueChange={(types) =>
                    // Keep the canonical order whatever order they were clicked in.
                    set(
                      "types",
                      CONTENT_TYPES.filter((type) => (types as string[]).includes(type)),
                    )
                  }
                >
                  {CONTENT_TYPES.map((type) => (
                    <ToggleGroupItem key={type} value={type}>
                      <ContentTypeIcon type={type} />
                      {t(`common.formats.${type}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {errors.types ? (
                  <p
                    id={`${lengthLabelId}-formats-hint`}
                    role="alert"
                    className="text-[13px] leading-snug text-danger"
                  >
                    {t(`generate.form.errors.${errors.types}`)}
                  </p>
                ) : (
                  <p
                    id={`${lengthLabelId}-formats-hint`}
                    className="text-[13px] leading-snug text-muted"
                  >
                    {t("generate.form.formatsHint")}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <span id={`${lengthLabelId}-source`} className="text-[13px] font-medium">
                    {t("generate.form.source")}
                  </span>
                  <ToggleGroup
                    type="single"
                    aria-labelledby={`${lengthLabelId}-source`}
                    value={values.sourceKind}
                    onValueChange={(kind) => kind && set("sourceKind", kind as SourceKind)}
                  >
                    {SOURCE_KINDS.map((kind) => (
                      <ToggleGroupItem key={kind} value={kind}>
                        {t(`generate.form.${SOURCE_LABEL[kind]}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {values.sourceKind === "none" ? (
                    <p className="text-[13px] leading-snug text-muted">
                      {t("generate.form.sourceHint")}
                    </p>
                  ) : null}
                </div>

                {values.sourceKind === "url" ? (
                  <Field
                    label={t("generate.form.sourceUrlLabel")}
                    hint={t("generate.form.sourceUrlHint")}
                    error={
                      errors.sourceUrl ? t(`generate.form.errors.${errors.sourceUrl}`) : undefined
                    }
                  >
                    <Input
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={values.sourceUrl}
                      onChange={(event) => set("sourceUrl", event.target.value)}
                      placeholder={t("generate.form.sourceUrlPlaceholder")}
                    />
                  </Field>
                ) : null}

                {values.sourceKind === "text" ? (
                  <Field
                    label={t("generate.form.sourceTextLabel")}
                    error={
                      errors.sourceText ? t(`generate.form.errors.${errors.sourceText}`) : undefined
                    }
                    aside={`${charCount(values.sourceText)}/${GENERATION_LIMITS.sourceTextMax}`}
                  >
                    <Textarea
                      rows={6}
                      value={values.sourceText}
                      onChange={(event) => set("sourceText", event.target.value)}
                      placeholder={t("generate.form.sourceTextPlaceholder")}
                    />
                  </Field>
                ) : null}
              </div>
            </fieldset>

            {requestError ? (
              <FormAlert tone="error">{t(`generate.errors.${requestError}`)}</FormAlert>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button type="submit" size="lg" loading={submitting} disabled={exhausted}>
                {submitting ? null : <Sparkles aria-hidden="true" />}
                {submitting ? t("generate.form.submitting") : t("generate.form.submit")}
              </Button>
              <p className="counter text-xs text-muted" aria-live="polite">
                {t("generate.form.remaining", { count: Math.max(remaining, 0) })}
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      {session ? (
        <section
          ref={resultsRef}
          aria-labelledby={`${lengthLabelId}-results`}
          className="flex scroll-mt-20 flex-col gap-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <h2
                  id={`${lengthLabelId}-results`}
                  className="text-lg font-semibold tracking-tight"
                >
                  {t("generate.results.title")}
                </h2>
                {session.mode === "sample" ? (
                  <Badge>{t("generate.results.sampleBadge")}</Badge>
                ) : (
                  <Badge variant="accent">{t("generate.results.liveBadge")}</Badge>
                )}
              </div>
              {session.mode === "sample" ? (
                <p className="max-w-xl text-sm leading-relaxed text-muted">
                  {t("generate.results.sampleNote")}
                </p>
              ) : null}
            </div>
            <p className="counter text-xs text-muted">
              {t("generate.results.regenerations", {
                left: regenerationsLeft,
                max: GENERATION_LIMITS.maxRegenerations,
              })}
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {session.types.map((type) => (
              <ResultCard
                key={`${session.generationId}:${type}`}
                type={type}
                session={session}
                regenerationsLeft={regenerationsLeft}
                onMeta={onMeta}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Which validation error, if any, belongs to each form field. */
const ERROR_KEY: Partial<Record<keyof GeneratorFormValues, keyof FormErrors>> = {
  topic: "topic",
  types: "types",
  sourceUrl: "sourceUrl",
  sourceText: "sourceText",
};

function ResultCard({
  type,
  session,
  regenerationsLeft,
  onMeta,
}: {
  type: ContentType;
  session: Session;
  regenerationsLeft: number;
  onMeta(meta: StreamMeta): void;
}) {
  const { generationId } = session;

  const request = useCallback<StreamRequestFactory>(
    ({ regenerate }) => ({
      url: regenerate ? "/api/generate/regenerate" : "/api/generate/stream",
      body: { generationId, type },
    }),
    [generationId, type],
  );

  const save = useCallback(
    (body: string) => saveContentAction({ generationId, type, body }),
    [generationId, type],
  );

  return (
    <StreamCard
      type={type}
      language={session.language}
      request={request}
      regenerationsLeft={regenerationsLeft}
      onMeta={onMeta}
      onSave={save}
      // The blog post is by far the longest piece: give it the full row.
      className={type === "blog" ? "xl:col-span-2" : undefined}
    />
  );
}

function QuotaBanner({
  plan,
  guest,
  resetDate,
}: {
  plan: Plan;
  guest: boolean;
  resetDate: string | null;
}) {
  const t = useTranslations("generate.quota");
  const kind = guest || plan === "guest" ? "guest" : plan === "pro" ? "pro" : "free";
  const href: Route = kind === "guest" ? "/app/upgrade" : "/app/settings";

  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-accent-ring bg-accent-soft p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold">{t(`${kind}Title`)}</p>
        <p className="max-w-xl text-sm leading-relaxed text-muted">
          {kind === "guest" ? t("guestBody") : t(`${kind}Body`, { date: resetDate ?? "" })}
        </p>
      </div>
      <Button asChild className="shrink-0">
        <Link href={href}>
          {kind === "guest" ? t("guestAction") : t("planAction")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
