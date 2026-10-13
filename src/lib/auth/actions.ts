"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { syncLocaleAfterAuth } from "@/i18n/sync";
import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { mapAuthError, type AuthErrorCode, type AuthNotice, type FieldErrorCode } from "./errors";
import { callbackUrl } from "./origin";
import { DEFAULT_AFTER_AUTH, safeNextPath } from "./redirect";
import {
  fieldErrors,
  formValues,
  guestSchema,
  oauthSchema,
  resetRequestSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  upgradeEmailSchema,
} from "./schemas";
import type { AuthFormState } from "./state";

/*
 * Every auth mutation goes through these Server Actions:
 *  - input is validated with zod on the server, whatever the browser sent;
 *  - Supabase errors are mapped to stable codes, never shown raw;
 *  - `next` destinations are sanitised to same-site paths (no open redirects);
 *  - redirect() is always called outside try/catch, because it works by throwing.
 */

type AuthErrorLike = { code?: string; status?: number; name?: string };

const SET_PASSWORD_PATH = "/update-password";

const failure = (code: AuthErrorCode, fields?: Record<string, FieldErrorCode>): AuthFormState => ({
  status: "error",
  code,
  fields,
  at: Date.now(),
});

const success = (notice: AuthNotice): AuthFormState => ({
  status: "success",
  notice,
  at: Date.now(),
});

/** When a Turnstile site key is configured, a token is mandatory on protected forms. */
function captchaMissing(token: string | undefined): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) && !token;
}

function fail(event: string, error: AuthErrorLike): AuthFormState {
  const code = mapAuthError(error);
  log.warn(event, { code, supabase_code: error.code, status: error.status });
  return failure(code);
}

function unexpected(event: string, error: unknown): AuthFormState {
  log.error(event, { name: error instanceof Error ? error.name : "unknown" });
  return failure("unavailable");
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = signInSchema.safeParse(
    formValues(formData, ["email", "password", "captchaToken", "next"]),
  );
  if (!parsed.success) return failure("invalid_input", fieldErrors(parsed.error));
  const { email, password, captchaToken, next } = parsed.data;
  if (captchaMissing(captchaToken)) return failure("captcha_required");

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: captchaToken || undefined },
    });
    if (error) return fail("auth.sign_in_failed", error);
  } catch (error) {
    return unexpected("auth.sign_in_threw", error);
  }

  await syncLocaleAfterAuth();
  redirect(safeNextPath(next) as Route);
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = signUpSchema.safeParse(
    formValues(formData, ["email", "password", "captchaToken", "next"]),
  );
  if (!parsed.success) return failure("invalid_input", fieldErrors(parsed.error));
  const { email, password, captchaToken, next } = parsed.data;
  if (captchaMissing(captchaToken)) return failure("captcha_required");

  const destination = safeNextPath(next);
  let hasSession = false;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: await callbackUrl(destination),
        captchaToken: captchaToken || undefined,
      },
    });
    if (error) return fail("auth.sign_up_failed", error);
    // With "Confirm email" on there is no session yet: the user must click the link.
    hasSession = Boolean(data.session);
  } catch (error) {
    return unexpected("auth.sign_up_threw", error);
  }

  if (!hasSession) return success("check_email_signup");
  await syncLocaleAfterAuth();
  redirect(destination as Route);
}

export async function guestAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = guestSchema.safeParse(formValues(formData, ["captchaToken"]));
  if (!parsed.success) return failure("invalid_input");
  const { captchaToken } = parsed.data;
  if (captchaMissing(captchaToken)) return failure("captcha_required");

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInAnonymously({
      options: { captchaToken: captchaToken || undefined },
    });
    if (error) return fail("auth.guest_failed", error);
  } catch (error) {
    return unexpected("auth.guest_threw", error);
  }

  await syncLocaleAfterAuth();
  redirect(DEFAULT_AFTER_AUTH as Route);
}

/** Starts the Google OAuth flow. Used as a plain form action (no form state). */
export async function googleSignInAction(formData: FormData): Promise<void> {
  const parsed = oauthSchema.safeParse(formValues(formData, ["next"]));
  const destination = safeNextPath(parsed.success ? parsed.data.next : undefined);

  let url: string | null = null;
  let code: AuthErrorCode = "provider_disabled";

  if (!isSupabaseConfigured()) {
    code = "not_configured";
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: await callbackUrl(destination) },
      });
      if (error) {
        code = mapAuthError(error);
        log.warn("auth.google_failed", { code, supabase_code: error.code });
      } else {
        url = data.url;
      }
    } catch (error) {
      code = "unavailable";
      log.error("auth.google_threw", { name: error instanceof Error ? error.name : "unknown" });
    }
  }

  // data.url points at Supabase's /authorize endpoint for this project.
  redirect((url ?? `/login?error=${code}`) as Route);
}

export async function requestPasswordResetAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = resetRequestSchema.safeParse(formValues(formData, ["email", "captchaToken"]));
  if (!parsed.success) return failure("invalid_input", fieldErrors(parsed.error));
  const { email, captchaToken } = parsed.data;
  if (captchaMissing(captchaToken)) return failure("captcha_required");

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: await callbackUrl(SET_PASSWORD_PATH),
      captchaToken: captchaToken || undefined,
    });
    if (error) {
      const code = mapAuthError(error);
      log.warn("auth.reset_request_failed", { code, supabase_code: error.code });
      // Only surface failures that say nothing about whether the account exists.
      if (code === "rate_limited" || code === "captcha_failed" || code === "unavailable") {
        return failure(code);
      }
    }
  } catch (error) {
    return unexpected("auth.reset_request_threw", error);
  }

  // Same answer whether or not the email is registered: no account enumeration.
  return success("check_email_reset");
}

export async function updatePasswordAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = updatePasswordSchema.safeParse(formValues(formData, ["password"]));
  if (!parsed.success) return failure("invalid_input", fieldErrors(parsed.error));

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return failure("session_missing");

    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return fail("auth.update_password_failed", error);
  } catch (error) {
    return unexpected("auth.update_password_threw", error);
  }

  redirect(DEFAULT_AFTER_AUTH as Route);
}

/**
 * Guest → account, with email. Adding an email to the anonymous user keeps the
 * same user id, so all saved content stays attached. Once the email is confirmed
 * the database trigger moves the plan from 'guest' to 'free'; the user then sets
 * a password on /update-password.
 */
export async function upgradeWithEmailAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured()) return failure("not_configured");

  const parsed = upgradeEmailSchema.safeParse(formValues(formData, ["email"]));
  if (!parsed.success) return failure("invalid_input", fieldErrors(parsed.error));

  let upgradedImmediately = false;

  try {
    const supabase = await createSupabaseServerClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return failure("session_missing");
    if (!userData.user.is_anonymous) return failure("email_taken");

    const { data, error } = await supabase.auth.updateUser(
      { email: parsed.data.email },
      { emailRedirectTo: await callbackUrl(SET_PASSWORD_PATH) },
    );
    if (error) return fail("auth.upgrade_email_failed", error);
    // With email confirmation off, the address is applied straight away.
    upgradedImmediately = data.user?.is_anonymous === false;
  } catch (error) {
    return unexpected("auth.upgrade_email_threw", error);
  }

  if (!upgradedImmediately) return success("check_email_upgrade");
  redirect(SET_PASSWORD_PATH as Route);
}

/** Guest → account, with Google. Links the identity to the current anonymous user. */
export async function upgradeWithGoogleAction(): Promise<void> {
  let url: string | null = null;
  let code: AuthErrorCode = "linking_disabled";

  if (!isSupabaseConfigured()) {
    code = "not_configured";
  } else {
    try {
      const supabase = await createSupabaseServerClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        code = "session_missing";
      } else {
        const { data, error } = await supabase.auth.linkIdentity({
          provider: "google",
          options: { redirectTo: await callbackUrl(DEFAULT_AFTER_AUTH) },
        });
        if (error) {
          code = mapAuthError(error);
          log.warn("auth.link_google_failed", { code, supabase_code: error.code });
        } else {
          url = data.url;
        }
      }
    } catch (error) {
      code = "unavailable";
      log.error("auth.link_google_threw", {
        name: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  redirect((url ?? `/app/upgrade?error=${code}`) as Route);
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch (error) {
      log.error("auth.sign_out_threw", { name: error instanceof Error ? error.name : "unknown" });
    }
  }
  redirect("/");
}
