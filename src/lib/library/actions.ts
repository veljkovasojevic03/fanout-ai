"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { contentStats } from "@/lib/content/contracts";
import { withinRateLimit } from "@/lib/generation/server";
import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { contentRowSchema, contentUpdateSchema, copyTitle, type LibraryErrorCode } from "./schema";

/*
 * Library mutations. All of them run as the signed-in user (anon key +
 * session), so RLS decides what can be touched: another user's id simply
 * matches no row. The service-role key is not used here at all.
 */

type Failure = { ok: false; code: LibraryErrorCode };

async function signedInClient() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user ?? null };
}

const threw = (event: string, error: unknown) =>
  log.error(event, { name: error instanceof Error ? error.name : "unknown" });

export type UpdateResult = { ok: true; updatedAt: string; tags: string[]; title: string } | Failure;

/**
 * Autosave. The word count is derived here from the text, never taken from
 * the client; tags come back normalised so the editor shows what was stored.
 */
export async function updateContentAction(input: unknown): Promise<UpdateResult> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };

  const parsed = contentUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const titleIssue = parsed.error.issues.some((issue) => issue.path[0] === "title");
    return { ok: false, code: titleIssue ? "title_required" : "invalid_input" };
  }
  const { id, title, body, language, tags } = parsed.data;

  try {
    const { supabase, user } = await signedInClient();
    if (!user) return { ok: false, code: "unauthenticated" };
    if (!(await withinRateLimit("contentWrite", user.id))) {
      return { ok: false, code: "rate_limited" };
    }

    const { data: current, error: lookupError } = await supabase
      .from("contents")
      .select("type")
      .eq("id", id)
      .maybeSingle();
    if (lookupError) {
      log.error("library.update_lookup_failed", { code: lookupError.code });
      return { ok: false, code: "save_failed" };
    }
    if (!current) return { ok: false, code: "not_found" };
    const type = contentRowSchema.shape.type.parse(current.type);

    const { data, error } = await supabase
      .from("contents")
      .update({
        title,
        body_md: body,
        language,
        tags,
        word_count: contentStats(type, body).words,
      })
      .eq("id", id)
      .select("updated_at")
      .maybeSingle();

    if (error) {
      log.error("library.update_failed", { code: error.code });
      return { ok: false, code: "save_failed" };
    }
    if (!data) return { ok: false, code: "not_found" };

    // No revalidatePath here: it would re-render the open editor after every
    // autosave. Pages under /app are dynamic, so the next navigation is fresh.
    return { ok: true, updatedAt: String(data.updated_at), tags, title };
  } catch (error) {
    threw("library.update_threw", error);
    return { ok: false, code: "save_failed" };
  }
}

const idSchema = z.object({ id: z.uuid() });

export type DeleteResult = { ok: true } | Failure;

export async function deleteContentAction(input: unknown): Promise<DeleteResult> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };

  try {
    const { supabase, user } = await signedInClient();
    if (!user) return { ok: false, code: "unauthenticated" };
    if (!(await withinRateLimit("contentWrite", user.id))) {
      return { ok: false, code: "rate_limited" };
    }

    const { data, error } = await supabase
      .from("contents")
      .delete()
      .eq("id", parsed.data.id)
      .select("id");

    if (error) {
      log.error("library.delete_failed", { code: error.code });
      return { ok: false, code: "delete_failed" };
    }
    if (!data || data.length === 0) return { ok: false, code: "not_found" };

    revalidatePath("/app", "layout");
    return { ok: true };
  } catch (error) {
    threw("library.delete_threw", error);
    return { ok: false, code: "delete_failed" };
  }
}

const duplicateSchema = idSchema.extend({
  /** Translated "(copy)" suffix from the UI. Only ever appended to the title. */
  suffix: z.string().trim().min(1).max(20),
});

export type DuplicateResult = { ok: true; id: string } | Failure;

/**
 * Copies a piece. The copy keeps its link to the original generation, so it
 * shares that generation's refine budget instead of escaping it.
 */
export async function duplicateContentAction(input: unknown): Promise<DuplicateResult> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const parsed = duplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };

  try {
    const { supabase, user } = await signedInClient();
    if (!user) return { ok: false, code: "unauthenticated" };
    if (!(await withinRateLimit("contentWrite", user.id))) {
      return { ok: false, code: "rate_limited" };
    }

    const { data: source, error: lookupError } = await supabase
      .from("contents")
      .select("type, title, body_md, language, tone, tags, word_count, generation_id")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (lookupError) {
      log.error("library.duplicate_lookup_failed", { code: lookupError.code });
      return { ok: false, code: "duplicate_failed" };
    }
    if (!source) return { ok: false, code: "not_found" };

    const { data: inserted, error } = await supabase
      .from("contents")
      .insert({
        user_id: user.id,
        generation_id: source.generation_id,
        type: source.type,
        title: copyTitle(String(source.title), parsed.data.suffix),
        body_md: source.body_md,
        language: source.language,
        tone: source.tone,
        tags: source.tags,
        word_count: source.word_count,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      log.error("library.duplicate_failed", { code: error?.code ?? "no_row" });
      return { ok: false, code: "duplicate_failed" };
    }

    revalidatePath("/app", "layout");
    return { ok: true, id: String(inserted.id) };
  } catch (error) {
    threw("library.duplicate_threw", error);
    return { ok: false, code: "duplicate_failed" };
  }
}
