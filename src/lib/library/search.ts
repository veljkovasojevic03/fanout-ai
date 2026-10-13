import type { Route } from "next";

import { CONTENT_TYPES, type ContentType } from "@/lib/presets";

import { normalizeTag } from "./tags";

/*
 * The library's filters live in the URL (?q=&type=&tag=&sort=&page=), so a
 * filtered view can be bookmarked, shared and reached with the back button.
 * Everything read from the URL is validated here before it gets near a query.
 */

export const LIBRARY_PAGE_SIZE = 12;
export const SEARCH_LIMITS = { queryMax: 100, maxTerms: 8 } as const;

export const LIBRARY_SORTS = ["updated", "newest", "oldest"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export type LibraryParams = {
  q: string;
  type: ContentType | null;
  tag: string | null;
  sort: LibrarySort;
  page: number;
};

export const DEFAULT_LIBRARY_PARAMS: LibraryParams = {
  q: "",
  type: null,
  tag: null,
  sort: "updated",
  page: 1,
};

/** The words of a search box entry: letters and digits only, lower case, capped. */
export function searchTerms(input: string): string[] {
  const terms = input
    .slice(0, SEARCH_LIMITS.queryMax)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return [...new Set(terms)].slice(0, SEARCH_LIMITS.maxTerms);
}

/**
 * Turns what the user typed into a Postgres `to_tsquery` string: every word
 * must match, and each matches as a prefix ("pric" finds "pricing").
 *
 * Only letters and digits survive, so tsquery operators (& | ! : * ( ) < >) and
 * quotes typed by the user can never change the query's structure or make it
 * fail to parse. Returns null when there is nothing to search for.
 */
export function buildSearchQuery(input: string): string | null {
  const terms = searchTerms(input);
  return terms.length === 0 ? null : terms.map((term) => `${term}:*`).join(" & ");
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** Reads the filters from `searchParams`; anything unknown falls back to its default. */
export function parseLibraryParams(raw: RawParams): LibraryParams {
  const type = first(raw.type);
  const sort = first(raw.sort);
  const page = Number.parseInt(first(raw.page), 10);

  return {
    q: first(raw.q).replace(/\s+/g, " ").trim().slice(0, SEARCH_LIMITS.queryMax),
    type: (CONTENT_TYPES as readonly string[]).includes(type) ? (type as ContentType) : null,
    tag: normalizeTag(first(raw.tag)),
    sort: (LIBRARY_SORTS as readonly string[]).includes(sort) ? (sort as LibrarySort) : "updated",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** The query string for a set of filters; defaults are left out to keep URLs short. */
export function libraryQuery(params: LibraryParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.q) query.q = params.q;
  if (params.type) query.type = params.type;
  if (params.tag) query.tag = params.tag;
  if (params.sort !== DEFAULT_LIBRARY_PARAMS.sort) query.sort = params.sort;
  if (params.page > 1) query.page = String(params.page);
  return query;
}

export function libraryHref(params: LibraryParams): Route {
  const query = new URLSearchParams(libraryQuery(params)).toString();
  return (query ? `/app/library?${query}` : "/app/library") as Route;
}

export const hasActiveFilters = (params: LibraryParams): boolean =>
  Boolean(params.q || params.type || params.tag);

export const pageCount = (total: number): number =>
  Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
