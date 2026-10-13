"use client";

import { Check, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import {
  useContentStream,
  type StreamRequestFactory,
} from "@/components/generator/use-content-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { INTL_LOCALE, type AppLocale } from "@/i18n/config";
import type { StreamMeta } from "@/lib/generation/schema";
import type { RefineRequest } from "@/lib/refine/schema";
import { cn } from "@/lib/utils";

type RefineSuggestionProps = {
  /** Sent to POST /api/refine as-is. */
  request: RefineRequest;
  /** Short description of what was asked, e.g. "Tone: Casual". */
  label: string;
  /** Language of the suggested text, for `lang`. */
  language: AppLocale;
  onAccept(text: string): void;
  onDiscard(): void;
  onMeta?(meta: StreamMeta): void;
};

/**
 * One refine suggestion, streaming in (spec §4.3). Nothing touches the piece
 * until Accept is pressed; Discard throws the suggestion away. Mount it with a
 * `key` per request — it starts streaming on mount, like a StreamCard.
 */
export function RefineSuggestion({
  request,
  label,
  language,
  onAccept,
  onDiscard,
  onMeta,
}: RefineSuggestionProps) {
  const t = useTranslations();

  const factory = useCallback<StreamRequestFactory>(
    () => ({ url: "/api/refine", body: request }),
    [request],
  );
  const { state, stop, regenerate } = useContentStream({ request: factory, onMeta });
  const { status, text } = state;

  const busy = status === "connecting" || status === "streaming";
  const partial = !busy && status !== "done" && text.trim() !== "";

  return (
    <section
      aria-label={t("editor.refine.region")}
      className={cn(
        "flex flex-col rounded-xl border bg-surface transition-colors duration-300",
        busy ? "border-accent-ring" : "border-border-strong",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h3 className="truncate text-sm font-semibold">{label}</h3>
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
          {status === "connecting"
            ? t("generate.card.waiting")
            : status === "streaming"
              ? t("generate.card.streaming")
              : status === "done"
                ? t("generate.card.done")
                : status === "stopped"
                  ? t("generate.card.stopped")
                  : t("generate.card.failed")}
        </p>
      </header>

      {state.mode === "sample" ? (
        <p className="border-b border-border px-4 py-2.5 text-[13px] leading-snug text-muted">
          {t("editor.refine.sampleNote")}
        </p>
      ) : null}

      <div tabIndex={0} className="max-h-80 min-h-24 overflow-y-auto px-4 py-3.5">
        {/* aria-busy holds the announcement back until the suggestion is complete. */}
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
            {partial ? ` ${t("editor.refine.partial")}` : ""}
          </p>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2.5">
        {busy ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            <Square aria-hidden="true" className="fill-current" />
            {t("editor.refine.stop")}
          </Button>
        ) : (
          <>
            {status === "error" ? (
              <Button size="sm" variant="ghost" onClick={regenerate}>
                <RotateCcw aria-hidden="true" />
                {t("editor.refine.retry")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onDiscard}>
              <X aria-hidden="true" />
              {t("editor.refine.discard")}
            </Button>
            <Button size="sm" onClick={() => onAccept(text)} disabled={text.trim() === ""}>
              <Check aria-hidden="true" />
              {t("editor.refine.accept")}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
