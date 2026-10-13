"use server";

import { revalidatePath } from "next/cache";

import { writeLocaleCookie } from "@/i18n/locale-cookie";
import { formValues } from "@/lib/auth/schemas";
import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  PROFILE_FIELDS,
  profileUpdateSchema,
  type ProfileErrorCode,
  type ProfileFormState,
} from "./schema";

const failure = (code: ProfileErrorCode, nameTooLong = false): ProfileFormState => ({
  status: "error",
  code,
  nameTooLong,
  at: Date.now(),
});

/**
 * Saves the editable profile fields. Runs as the user (anon key + session), so
 * RLS limits it to their own row and the column grants limit it to these four
 * columns — the server does not need the service role for this.
 */
export async function updateProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  if (!isSupabaseConfigured()) return failure("save_failed");

  const parsed = profileUpdateSchema.safeParse(formValues(formData, PROFILE_FIELDS));
  if (!parsed.success) {
    const nameTooLong = parsed.error.issues.some((issue) => issue.path[0] === "display_name");
    return failure("invalid_input", nameTooLong);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return failure("session_missing");

    const { error } = await supabase
      .from("profiles")
      .update(parsed.data)
      .eq("id", userData.user.id);
    if (error) {
      log.error("profile.update_failed", { code: error.code });
      return failure("save_failed");
    }
  } catch (error) {
    log.error("profile.update_threw", { name: error instanceof Error ? error.name : "unknown" });
    return failure("save_failed");
  }

  // The interface language is also what the cookie holds; keep the two in step.
  await writeLocaleCookie(parsed.data.ui_language);
  revalidatePath("/", "layout");

  return { status: "success", at: Date.now() };
}
