import "server-only";

import { z } from "zod";

import { log } from "@/lib/log";
import { CONTENT_TYPES } from "@/lib/presets";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const recentItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(CONTENT_TYPES),
  title: z.string(),
  word_count: z.number().int(),
  updated_at: z.string(),
});

export type RecentItem = z.infer<typeof recentItemSchema>;
export type RecentContent = { items: RecentItem[]; total: number };

const RECENT_LIMIT = 5;

/**
 * The user's latest saved pieces and how many they have in total. Read as the
 * user, so RLS scopes it to their own rows. Returns null on failure so the
 * dashboard can show an error for this section only.
 */
export async function getRecentContent(): Promise<RecentContent | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error, count } = await supabase
      .from("contents")
      .select("id, type, title, word_count, updated_at", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(RECENT_LIMIT);

    if (error) {
      log.error("dashboard.recent_failed", { code: error.code });
      return null;
    }
    const items = z.array(recentItemSchema).parse(data ?? []);
    return { items, total: count ?? items.length };
  } catch (error) {
    log.error("dashboard.recent_threw", { name: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}
