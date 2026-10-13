"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_LIBRARY_PARAMS,
  hasActiveFilters,
  LIBRARY_SORTS,
  libraryHref,
  SEARCH_LIMITS,
  type LibraryParams,
  type LibrarySort,
} from "@/lib/library/search";
import { CONTENT_TYPES, type ContentType } from "@/lib/presets";

// Stored tags are always lower case, so this value can never be a real tag.
const ALL = "ALL";
const SEARCH_DEBOUNCE_MS = 300;

type LibraryFiltersProps = {
  params: LibraryParams;
  /** The user's tags, most used first. The tag filter is hidden when there are none. */
  tags: readonly string[];
};

/**
 * Search, format, tag and sort controls for the library. The filters live in
 * the URL: every change replaces the query string and the server renders the
 * matching page. Typing in the search box is debounced.
 */
export function LibraryFilters({ params, tags }: LibraryFiltersProps) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.q);
  const timer = useRef<number | null>(null);

  // The URL is the source of truth, but the box must not be overwritten by the
  // echo of what was just typed. `applied` is the last query this component
  // sent; a different one in the URL came from elsewhere (a "Clear filters"
  // link, the back button) and is adopted.
  const [applied, setApplied] = useState(params.q);
  const [seen, setSeen] = useState(params.q);
  if (params.q !== seen) {
    setSeen(params.q);
    if (params.q !== applied) {
      setApplied(params.q);
      setSearch(params.q);
    }
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  /** Any filter change goes back to the first page. */
  function apply(change: Partial<LibraryParams>) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const next = { ...params, q: search.trim(), ...change, page: 1 };
    setApplied(next.q);
    startTransition(() => router.replace(libraryHref(next), { scroll: false }));
  }

  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => apply({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
  }

  function clear() {
    setSearch("");
    apply({ ...DEFAULT_LIBRARY_PARAMS, sort: params.sort });
  }

  // A tag that is filtered on must stay selectable even if it is not in the top list.
  const tagOptions = params.tag && !tags.includes(params.tag) ? [params.tag, ...tags] : tags;

  return (
    <form
      role="search"
      aria-label={t("library.filters.legend")}
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: search.trim() });
      }}
      className="flex flex-col gap-4 lg:flex-row lg:items-end"
    >
      <Field label={t("library.filters.search")} className="min-w-0 lg:flex-1">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("library.filters.searchPlaceholder")}
            maxLength={SEARCH_LIMITS.queryMax}
            enterKeyHint="search"
            autoComplete="off"
            className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {pending ? (
            <LoaderCircle
              role="status"
              aria-label={t("library.filters.searching")}
              className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted"
            />
          ) : null}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:items-end">
        <Field label={t("library.filters.type")} className="sm:w-44">
          <Select
            value={params.type ?? ALL}
            onValueChange={(value) =>
              apply({ type: value === ALL ? null : (value as ContentType) })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("library.filters.allTypes")}</SelectItem>
              {CONTENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`common.formats.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {tagOptions.length > 0 ? (
          <Field label={t("library.filters.tag")} className="sm:w-44">
            <Select
              value={params.tag ?? ALL}
              onValueChange={(value) => apply({ tag: value === ALL ? null : value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("library.filters.allTags")}</SelectItem>
                {tagOptions.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        <Field label={t("library.filters.sort")} className="sm:w-48">
          <Select
            value={params.sort}
            onValueChange={(value) => apply({ sort: value as LibrarySort })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIBRARY_SORTS.map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {t(`library.filters.sorts.${sort}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {hasActiveFilters(params) ? (
          <Button variant="ghost" onClick={clear} className="col-span-2 sm:col-span-1">
            <X aria-hidden="true" />
            {t("library.filters.clear")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
