"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useFieldControl } from "@/components/ui/field";
import { GENERATION_LIMITS } from "@/lib/generation/schema";
import { cn } from "@/lib/utils";

type KeywordInputProps = {
  value: readonly string[];
  onChange(next: string[]): void;
  disabled?: boolean;
};

/** Adds `raw` (which may hold several comma-separated keywords) to the list, within the limits. */
export function addKeywords(current: readonly string[], raw: string): string[] {
  const next = [...current];
  for (const part of raw.split(/[,\n]/)) {
    const keyword = part.replace(/\s+/g, " ").trim().slice(0, GENERATION_LIMITS.keywordMax);
    if (!keyword) continue;
    if (next.length >= GENERATION_LIMITS.keywordsMax) break;
    if (next.some((existing) => existing.toLowerCase() === keyword.toLowerCase())) continue;
    next.push(keyword);
  }
  return next;
}

/**
 * Keyword chips. Enter or a comma adds the typed keyword, Backspace in an empty
 * field removes the last one, and pasting a comma-separated list adds them all.
 */
export function KeywordInput({ value, onChange, disabled }: KeywordInputProps) {
  const t = useTranslations("generate.form");
  const [draft, setDraft] = useState("");
  const control = useFieldControl<{ id?: string; "aria-describedby"?: string }>({});
  const full = value.length >= GENERATION_LIMITS.keywordsMax;

  function commit(raw: string) {
    const next = addKeywords(value, raw);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }

  return (
    <div
      className={cn(
        "flex min-h-9.5 w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5",
        "transition-[border-color,box-shadow] duration-150 hover:border-border-strong",
        "focus-within:border-accent-ring focus-within:shadow-[0_0_0_3px_var(--accent-soft)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {value.map((keyword) => (
        <span
          key={keyword}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm border border-border-strong bg-elevated pr-0.5 pl-2 text-[13px]"
        >
          <span className="truncate">{keyword}</span>
          <button
            type="button"
            aria-label={t("keywordRemove", { keyword })}
            onClick={() => onChange(value.filter((existing) => existing !== keyword))}
            className="flex size-5 shrink-0 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <input
        {...control}
        type="text"
        value={draft}
        disabled={disabled || full}
        placeholder={full ? t("keywordsFull") : t("keywordsPlaceholder")}
        enterKeyHint="done"
        autoComplete="off"
        onChange={(event) => {
          const next = event.target.value;
          // A comma (typed or pasted) finishes the keyword(s) before it.
          if (next.includes(",")) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Never submit the whole form from the keyword field.
            event.preventDefault();
            if (draft.trim()) commit(draft);
          } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        className="h-6 min-w-28 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none"
      />
    </div>
  );
}
