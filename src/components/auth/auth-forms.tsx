"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  googleSignInAction,
  guestAction,
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  upgradeWithEmailAction,
  upgradeWithGoogleAction,
} from "@/lib/auth/actions";
import type { AuthErrorCode } from "@/lib/auth/errors";
import { IDLE_STATE, type AuthFormState } from "@/lib/auth/state";

import { CaptchaField, FormStateAlert, GoogleIcon, SubmitButton } from "./form-parts";

/** Translated message for a field's validation error, if it has one. */
function useFieldError(state: AuthFormState) {
  const t = useTranslations("auth.fieldErrors");
  return (name: string): string | undefined => {
    const code = state.status === "error" ? state.fields?.[name] : undefined;
    return code ? t(code) : undefined;
  };
}

/** Changes after every submit, remounting the single-use CAPTCHA widget. */
const attemptKey = (state: AuthFormState) => (state.status === "idle" ? 0 : state.at);

/*
 * React resets uncontrolled inputs after a form action completes, so the email
 * is kept in state to survive a failed attempt. Passwords are meant to clear.
 */
function EmailField({
  error,
  value,
  onChange,
}: {
  error: string | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("auth.fields");
  return (
    <Field label={t("email")} error={error}>
      <Input
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("emailPlaceholder")}
      />
    </Field>
  );
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: AuthErrorCode }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(signInAction, IDLE_STATE);
  const [email, setEmail] = useState("");
  const fieldError = useFieldError(state);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} initialError={initialError} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField error={fieldError("email")} value={email} onChange={setEmail} />
      <Field label={t("fields.password")} error={fieldError("password")}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">{t("login.submit")}</SubmitButton>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const t = useTranslations("auth");
  const [state, action] = useActionState(signUpAction, IDLE_STATE);
  const [email, setEmail] = useState("");
  const fieldError = useFieldError(state);

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField error={fieldError("email")} value={email} onChange={setEmail} />
      <Field
        label={t("fields.password")}
        hint={t("fields.passwordHint")}
        error={fieldError("password")}
      >
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">{t("signup.submit")}</SubmitButton>
    </form>
  );
}

export function GoogleButton({ next, mode }: { next?: string; mode: "continue" | "signUp" }) {
  const t = useTranslations("auth.google");
  return (
    <form action={googleSignInAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <SubmitButton variant="secondary" size="lg" className="w-full">
        <GoogleIcon className="size-4" />
        {t(mode)}
      </SubmitButton>
    </form>
  );
}

export function GuestForm() {
  const t = useTranslations("auth.guest");
  const [state, action] = useActionState(guestAction, IDLE_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStateAlert state={state} />
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">{t("submit")}</SubmitButton>
    </form>
  );
}

export function ResetRequestForm() {
  const t = useTranslations("auth.reset");
  const [state, action] = useActionState(requestPasswordResetAction, IDLE_STATE);
  const [email, setEmail] = useState("");
  const fieldError = useFieldError(state);

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <EmailField error={fieldError("email")} value={email} onChange={setEmail} />
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">{t("submit")}</SubmitButton>
    </form>
  );
}

export function UpdatePasswordForm() {
  const t = useTranslations("auth");
  const [state, action] = useActionState(updatePasswordAction, IDLE_STATE);
  const fieldError = useFieldError(state);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <Field
        label={t("fields.newPassword")}
        hint={t("fields.passwordHint")}
        error={fieldError("password")}
      >
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
        />
      </Field>
      <SubmitButton size="lg">{t("updatePassword.submit")}</SubmitButton>
    </form>
  );
}

export function UpgradeEmailForm() {
  const t = useTranslations("auth.upgrade");
  const [state, action] = useActionState(upgradeWithEmailAction, IDLE_STATE);
  const [email, setEmail] = useState("");
  const fieldError = useFieldError(state);

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <EmailField error={fieldError("email")} value={email} onChange={setEmail} />
      <SubmitButton size="lg">{t("emailSubmit")}</SubmitButton>
    </form>
  );
}

export function UpgradeGoogleButton() {
  const t = useTranslations("auth.google");
  return (
    <form action={upgradeWithGoogleAction}>
      <SubmitButton variant="secondary" size="lg" className="w-full">
        <GoogleIcon className="size-4" />
        {t("continue")}
      </SubmitButton>
    </form>
  );
}
