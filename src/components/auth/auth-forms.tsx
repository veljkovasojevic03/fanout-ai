"use client";

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
import { FIELD_ERROR_MESSAGES, type AuthErrorCode } from "@/lib/auth/errors";
import { IDLE_STATE, type AuthFormState } from "@/lib/auth/state";

import { CaptchaField, FormStateAlert, GoogleIcon, SubmitButton } from "./form-parts";

const fieldError = (state: AuthFormState, name: string): string | undefined => {
  const code = state.status === "error" ? state.fields?.[name] : undefined;
  return code ? FIELD_ERROR_MESSAGES[code] : undefined;
};

/** Changes after every submit, remounting the single-use CAPTCHA widget. */
const attemptKey = (state: AuthFormState) => (state.status === "idle" ? 0 : state.at);

/*
 * React resets uncontrolled inputs after a form action completes, so the email
 * is kept in state to survive a failed attempt. Passwords are meant to clear.
 */
function EmailField({
  state,
  value,
  onChange,
}: {
  state: AuthFormState;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Email" error={fieldError(state, "email")}>
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
        placeholder="you@example.com"
      />
    </Field>
  );
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: AuthErrorCode }) {
  const [state, action] = useActionState(signInAction, IDLE_STATE);
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} initialError={initialError} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField state={state} value={email} onChange={setEmail} />
      <Field label="Password" error={fieldError(state, "password")}>
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">Log in</SubmitButton>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUpAction, IDLE_STATE);
  const [email, setEmail] = useState("");

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField state={state} value={email} onChange={setEmail} />
      <Field label="Password" hint="At least 8 characters." error={fieldError(state, "password")}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">Create account</SubmitButton>
    </form>
  );
}

export function GoogleButton({ next, label }: { next?: string; label: string }) {
  return (
    <form action={googleSignInAction}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <SubmitButton variant="secondary" size="lg" className="w-full">
        <GoogleIcon className="size-4" />
        {label}
      </SubmitButton>
    </form>
  );
}

export function GuestForm() {
  const [state, action] = useActionState(guestAction, IDLE_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormStateAlert state={state} />
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">Continue as guest</SubmitButton>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action] = useActionState(requestPasswordResetAction, IDLE_STATE);
  const [email, setEmail] = useState("");

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <EmailField state={state} value={email} onChange={setEmail} />
      <CaptchaField key={attemptKey(state)} />
      <SubmitButton size="lg">Send reset link</SubmitButton>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePasswordAction, IDLE_STATE);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <Field
        label="New password"
        hint="At least 8 characters."
        error={fieldError(state, "password")}
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
      <SubmitButton size="lg">Save password</SubmitButton>
    </form>
  );
}

export function UpgradeEmailForm() {
  const [state, action] = useActionState(upgradeWithEmailAction, IDLE_STATE);
  const [email, setEmail] = useState("");

  if (state.status === "success") return <FormStateAlert state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormStateAlert state={state} />
      <EmailField state={state} value={email} onChange={setEmail} />
      <SubmitButton size="lg">Continue with email</SubmitButton>
    </form>
  );
}

export function UpgradeGoogleButton() {
  return (
    <form action={upgradeWithGoogleAction}>
      <SubmitButton variant="secondary" size="lg" className="w-full">
        <GoogleIcon className="size-4" />
        Continue with Google
      </SubmitButton>
    </form>
  );
}
