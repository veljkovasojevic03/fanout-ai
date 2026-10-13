"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { APP_LOCALES } from "./config";
import { writeLocaleCookie } from "./locale-cookie";

const localeSchema = z.enum(APP_LOCALES);

/**
 * Language switcher. Always sets the cookie (works for logged-out visitors);
 * for signed-in users the choice is also saved to their profile so it follows
 * them to other devices.
 */
export async function setLocaleAction(value: string): Promise<{ ok: boolean }> {
  const parsed = localeSchema.safeParse(value);
  if (!parsed.success) return { ok: false };
  const locale = parsed.data;

  await writeLocaleCookie(locale);

  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { error } = await supabase
          .from("profiles")
          .update({ ui_language: locale })
          .eq("id", data.user.id);
        if (error) log.warn("i18n.profile_update_failed", { code: error.code });
      }
    } catch (error) {
      // The cookie is already set, so the UI still switches.
      log.warn("i18n.profile_update_threw", {
        name: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
