import "server-only";

import { log } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { isAppLocale } from "./config";
import { readLocaleCookie, writeLocaleCookie } from "./locale-cookie";

/**
 * Reconciles the language cookie with `profiles.ui_language` right after sign-in.
 *
 *  - Cookie present: the visitor chose a language on this device, so it wins and
 *    is saved to the profile.
 *  - No cookie (new device or browser): the profile's language is applied.
 *
 * Best-effort: a failure here must never block signing in.
 */
export async function syncLocaleAfterAuth(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;

    const chosen = await readLocaleCookie();

    if (chosen) {
      await supabase
        .from("profiles")
        .update({ ui_language: chosen })
        .eq("id", user.id)
        .neq("ui_language", chosen);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("ui_language")
      .eq("id", user.id)
      .maybeSingle();
    if (isAppLocale(profile?.ui_language)) await writeLocaleCookie(profile.ui_language);
  } catch (error) {
    log.warn("i18n.sync_failed", { name: error instanceof Error ? error.name : "unknown" });
  }
}
