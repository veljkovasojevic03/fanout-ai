import "server-only";

import { z } from "zod";

import { log } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  contentListItemSchema,
  contentRowSchema,
  type ContentListItem,
  type ContentRow,
} from "./schema";
import { buildSearchQuery, LIBRARY_PAGE_SIZE, type LibraryParams } from "./search";

/*
 * Library reads. Every query runs as the signed-in user (anon key + session),
 * so RLS scopes it to their own rows — there is no user id filter to forget.
 * Each returns null on failure so the page can show an error state.
 */

export type ContentPage = { items: ContentListItem[]; total: number };

const SORT_COLUMN = {
  updated: { column: "updated_at", ascending: false },
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
} as const;

/** PostgREST answers 416 / PGRST103 when the requested page starts past the last row. */
const isPastLastPage = (error: { code?: string }, status: number) =>
  status === 416 || error.code === "PGRST103";

export async function listContents(params: LibraryParams): Promise<ContentPage | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const from = (params.page - 1) * LIBRARY_PAGE_SIZE;
    const sort = SORT_COLUMN[params.sort];

    let query = supabase
      .from("contents")
      .select("id, type, title, language, tags, word_count, updated_at", { count: "exact" });

    const search = buildSearchQuery(params.q);
    if (search) query = query.textSearch("search", search, { config: "simple" });
    if (params.type) query = query.eq("type", params.type);
    if (params.tag) query = query.contains("tags", [params.tag]);

    const { data, error, count, status } = await query
      .order(sort.column, { ascending: sort.ascending })
      // A stable tie-break keeps rows from jumping between pages.
      .order("id", { ascending: true })
      .range(from, from + LIBRARY_PAGE_SIZE - 1);

    if (error) {
      if (isPastLastPage(error, status)) return { items: [], total: count ?? 0 };
      log.error("library.list_failed", { code: error.code });
      return null;
    }

    const items = z.array(contentListItemSchema).parse(data ?? []);
    return { items, total: count ?? items.length };
  } catch (error) {
    log.error("library.list_threw", { name: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

export type ContentLookup =
  { status: "ok"; content: ContentRow } | { status: "not_found" } | { status: "error" };

export async function getContent(id: string): Promise<ContentLookup> {
  if (!z.uuid().safeParse(id).success) return { status: "not_found" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contents")
      .select(
        "id, type, title, body_md, language, tone, tags, word_count, generation_id, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      log.error("library.get_failed", { code: error.code });
      return { status: "error" };
    }
    // Another user's id returns no row under RLS: indistinguishable from a missing one.
    if (!data) return { status: "not_found" };
    return { status: "ok", content: contentRowSchema.parse(data) };
  } catch (error) {
    log.error("library.get_threw", { name: error instanceof Error ? error.name : "unknown" });
    return { status: "error" };
  }
}

/** The user's tags, most used first — for the tag filter and autocomplete. Empty on failure. */
export async function getUserTags(): Promise<string[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("content_tags");
    if (error) {
      log.error("library.tags_failed", { code: error.code });
      return [];
    }
    return z
      .array(z.object({ tag: z.string() }))
      .parse(data ?? [])
      .map((row) => row.tag);
  } catch (error) {
    log.error("library.tags_threw", { name: error instanceof Error ? error.name : "unknown" });
    return [];
  }
}

/** Refinements already used on the generation a piece came from; null when it has none. */
export async function getRefinementsUsed(generationId: string | null): Promise<number | null> {
  if (!generationId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("generations")
      .select("refinements_used")
      .eq("id", generationId)
      .maybeSingle();
    if (error || !data) return null;
    return z.number().int().parse(data.refinements_used);
  } catch {
    return null;
  }
}
