"use client";

import { Check, Copy, RotateCcw, Save, Square, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { INTL_LOCALE, type AppLocale } from "@/i18n/config";
import { contentStats, isContractWarningCode, LIMITS } from "@/lib/content/contracts";
import type { SaveResult } from "@/lib/generation/actions";
import type { StreamMeta } from "@/lib/generation/schema";
import type { ContentType } from "@/lib/presets";
import { cn } from "@/lib/utils";

import { useContentStream, type StreamRequestFactory } from "./use-content-stream";

type StreamCardProps = {
  type: ContentType;
  /** Language of the generated text, for `lang` (pronunciation, hyphenation). */
  language: AppLocale;
  request: StreamRequestFactory;
  /** Regenerations left for the whole generation; null = not limited (demo). */
  regenerationsLeft: number | null;
  onMeta?(meta: StreamMeta): void;
  /** Omit to hide the Save button (e.g. in the public demo). */
  onSave?(text: string): Promise<SaveResult>;
  className?: string;
};

const NEAR_BOTTOM_PX = 48;

/**
 * One piece of content, streaming in. Shows a caret while text arrives, live
 * word/character counters (per post for X threads), the format check once the
 * piece is complete, and copy / save / stop / regenerate.
 */
export function StreamCard({
  type,
  language,
  request,
  regenerationsLeft,
  onMeta,
  onSave,
  className,
}: StreamCardProps) {
  const t = useTranslations();
  const router = useRouter();
  const { state, stop, regenerate } = useContentStream({ request, onMeta });
  const { status, text } = state;

  const busy = status === "connecting" || status === "streaming";
  const format = t(`common.formats.${type}`);
  const stats = useMemo(() => contentStats(type, text), [type, text]);

  // Saved state belongs to one exact text: any new text makes it savable again.
  const [savedText, setSavedText] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const saved = savedText !== null && savedText === text;

  // Follow the text as it grows, unless the reader has scrolled up to read.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const element = scrollRef.current;
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("generate.card.copied"));
    } catch {
      toast.error(t("generate.card.copyFailed"));
    }
  }

  function save() {
    if (!onSave) return;
    const snapshot = text;
    startSaving(async () => {
      const result = await onSave(snapshot);
      if (result.ok) {
        setSavedText(snapshot);
        toast.success(t("generate.card.savedToast"), {
          action: {
            label: t("generate.card.openSaved"),
            onClick: () => router.push(`/app/library/${result.id}` as Route),
          },
        });
      } else {
        toast.error(t(`generate.errors.${result.code}`));
      }
    });
  }

  const statusLabel =
    status === "connecting"
      ? t("generate.card.waiting")
      : status === "streaming"
        ? t("generate.card.streaming")
        : status === "done"
          ? t("generate.card.done")
          : status === "stopped"
            ? t("generate.card.stopped")
            : t("generate.card.failed");

  const canRegenerate = !busy && (regenerationsLeft === null || regenerationsLeft > 0);
  const warnings =
    status === "done" ? state.warnings.filter((w) => isContractWarningCode(w.code)) : [];

  return (
    <section
      aria-label={t("generate.card.region", { format })}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-surface transition-colors duration-300",
        status === "streaming" ? "border-accent-ring" : "border-border",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
            <ContentTypeIcon type={type} className="size-3.5" />
          </span>
          <h3 className="truncate text-sm font-semibold">{format}</h3>
          {state.mode === "sample" ? (
            <Badge>{t("generate.results.sampleBadge")}</Badge>
          ) : state.mode === "live" ? (
            <Badge variant="accent">{t("generate.results.liveBadge")}</Badge>
          ) : null}
        </div>
        <p
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-xs",
            status === "error" ? "text-danger" : busy ? "text-accent" : "text-muted",
          )}
        >
          {busy ? (
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-accent" />
          ) : null}
          {statusLabel}
        </p>
      </header>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        }}
        tabIndex={0}
        className="max-h-96 min-h-36 overflow-y-auto px-4 py-3.5"
      >
        {/*
          aria-busy holds the announcement back while tokens arrive, so a screen
          reader reads the finished piece once instead of every word as it lands.
        */}
        <div
          aria-live="polite"
          aria-busy={busy}
          lang={INTL_LOCALE[language]}
          className="text-sm leading-relaxed break-words whitespace-pre-wrap"
        >
          {text}
          {status === "streaming" && text !== "" ? (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-caret bg-accent"
            />
          ) : null}
        </div>
        {text === "" && busy ? (
          <div aria-hidden="true" className="flex flex-col gap-2.5 pt-1">
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/6" />
          </div>
        ) : null}
      </div>

      {status === "error" && state.error ? (
        <div
          role="alert"
          className="mx-4 mb-3 flex items-start gap-2.5 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[13px] leading-snug text-danger"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          <p>
            {t(`generate.errors.${state.error}`)}
            {text ? ` ${t("generate.card.partialKept")}` : ""}
          </p>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mx-4 mb-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] leading-snug text-warn">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {t("generate.warnings.title")}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-6">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                {t(`generate.warnings.${warning.code}`, warning.values)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {type === "x_thread" && stats.posts && stats.posts.length > 0 ? (
        <ul aria-label={t("generate.card.postsLabel")} className="mx-4 mb-3 flex flex-wrap gap-1.5">
          {stats.posts.map((post, index) => {
            const over = post.chars > LIMITS.xPostChars;
            return (
              <li
                key={index}
                title={t("generate.card.postCounter", {
                  post: post.number,
                  chars: post.chars,
                  max: LIMITS.xPostChars,
                })}
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 counter text-[11px]",
                  over
                    ? "border-danger/30 bg-danger-soft text-danger"
                    : "border-border bg-white/[0.03] text-muted",
                )}
              >
                <span className="sr-only">
                  {t("generate.card.postCounter", {
                    post: post.number,
                    chars: post.chars,
                    max: LIMITS.xPostChars,
                  })}
                </span>
                <span aria-hidden="true">
                  {post.number}/ <span className={over ? "" : "text-foreground"}>{post.chars}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-4 py-2.5">
        <p className="counter text-xs text-muted">
          {type === "x_thread" && stats.posts ? (
            <>
              {t("generate.card.posts", { count: stats.posts.length })}
              {" · "}
            </>
          ) : null}
          {t("generate.card.words", { count: stats.words })}
          {" · "}
          {t("generate.card.chars", { count: stats.chars })}
        </p>

        <div className="flex items-center gap-1">
          {busy ? (
            <Button size="sm" variant="secondary" onClick={stop}>
              <Square aria-hidden="true" className="fill-current" />
              {t("generate.card.stop")}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={copy} disabled={!text}>
                <Copy aria-hidden="true" />
                {t("generate.card.copy")}
              </Button>
              {onSave ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={save}
                  disabled={!text || saved}
                  loading={saving}
                >
                  {saved ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
                  {saving
                    ? t("generate.card.saving")
                    : saved
                      ? t("generate.card.saved")
                      : t("generate.card.save")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={regenerate} disabled={!canRegenerate}>
                <RotateCcw aria-hidden="true" />
                {status === "error" ? t("generate.card.retry") : t("generate.card.regenerate")}
              </Button>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}
