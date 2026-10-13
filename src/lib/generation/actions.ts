"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { contentStats, deriveTitle } from "@/lib/content/contracts";
import { log } from "@/lib/log";
import { CONTENT_TYPES } from "@/lib/presets";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { GenerateErrorCode } from "./errors";
import { withinRateLimit } from "./server";

const saveSchema = z.object({
  generationId: z.uuid(),
  type: z.enum(CONTENT_TYPES),
  body: z.string().trim().min(1).max(100_000),
});

export type SaveResult = { ok: true; id: string } | { ok: false; code: GenerateErrorCode };

/**
 * Saves one generated piece to the user's library.
 *
 * Runs as the user (anon key + session), so RLS decides: the row can only be
 * inserted for themselves, and only linked to one of their own generations.
 * Title and word count are derived here from the text, not taken from the client.
 */
export async function saveContentAction(input: unknown): Promise<SaveResult> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const { generationId, type, body } = parsed.data;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return { ok: false, code: "unauthenticated" };

    if (!(await withinRateLimit("save", user.id))) return { ok: false, code: "rate_limited" };

    // Read through RLS: another user's generation id simply returns no row.
    const { data: generation, error: generationError } = await supabase
      .from("generations")
      .select("topic, tone, content_language")
      .eq("id", generationId)
      .maybeSingle();
    if (generationError) {
      log.error("content.save_lookup_failed", { code: generationError.code });
      return { ok: false, code: "save_failed" };
    }
    if (!generation) return { ok: false, code: "not_found" };

    const { data: inserted, error } = await supabase
      .from("contents")
      .insert({
        user_id: user.id,
        generation_id: generationId,
        type,
        title: deriveTitle(type, body, String(generation.topic ?? "")),
        body_md: body,
        language: generation.content_language,
        tone: generation.tone,
        word_count: contentStats(type, body).words,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      log.error("content.save_failed", { code: error?.code ?? "no_row" });
      return { ok: false, code: "save_failed" };
    }

    // The dashboard's "saved pieces" and "recent content" are now stale.
    revalidatePath("/app", "layout");
    return { ok: true, id: String(inserted.id) };
  } catch (error) {
    log.error("content.save_threw", { name: error instanceof Error ? error.name : "unknown" });
    return { ok: false, code: "save_failed" };
  }
}
