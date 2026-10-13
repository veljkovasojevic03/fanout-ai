"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useFieldControl } from "@/components/ui/field";
import { addTags, normalizeTag, suggestTags, TAG_LIMITS } from "@/lib/library/tags";
import { cn } from "@/lib/utils";

type TagInputProps = {
  value: readonly string[];
  onChange(next: string[]): void;
  /** The user's existing tags, offered as autocomplete suggestions. */
  suggestions?: readonly string[];
  disabled?: boolean;
};

/**
 * Tag chips with autocomplete (spec §4.4). Enter or a comma adds the typed tag,
 * Backspace in an empty field removes the last one. Suggestions use a native
 * <datalist>, so they work with the keyboard and screen readers as-is.
 */
export function TagInput({ value, onChange, suggestions = [], disabled }: TagInputProps) {
  const t = useTranslations("editor.tags");
  const listId = useId();
  const [draft, setDraft] = useState("");
  const control = useFieldControl<{ id?: string; "aria-describedby"?: string }>({});
  const full = value.length >= TAG_LIMITS.maxPerContent;
  const options = suggestTags(suggestions, value, draft);

  function commit(raw: string) {
    const next = addTags(value, raw);
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
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-sm border border-border-strong bg-elevated pr-0.5 pl-2 text-[13px]"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={t("remove", { tag })}
            onClick={() => onChange(value.filter((existing) => existing !== tag))}
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
        list={listId}
        disabled={disabled || full}
        maxLength={TAG_LIMITS.maxLength * 2}
        placeholder={full ? t("full") : t("placeholder")}
        enterKeyHint="done"
        autoComplete="off"
        autoCapitalize="none"
        onChange={(event) => {
          const next = event.target.value;
          const inputType = (event.nativeEvent as InputEvent).inputType;
          // Picking a suggestion replaces the whole field in one step (it is not
          // typed character by character): add it straight away.
          const picked =
            inputType !== "insertText" &&
            inputType !== "deleteContentBackward" &&
            options.includes(normalizeTag(next) ?? "");
          if (next.includes(",") || picked) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Never submit a surrounding form from the tag field.
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
      <datalist id={listId}>
        {options.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
