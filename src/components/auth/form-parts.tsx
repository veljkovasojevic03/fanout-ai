"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { AUTH_ERROR_MESSAGES, AUTH_NOTICES, type AuthErrorCode } from "@/lib/auth/errors";
import type { AuthFormState } from "@/lib/auth/state";
import { cn } from "@/lib/utils";

/** Submit button that shows a spinner while its form's action is running. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, "type" | "loading">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

type AlertProps = { tone: "error" | "success"; children: React.ReactNode; className?: string };

/** Inline form message. Errors are announced immediately, notices politely. */
export function FormAlert({ tone, children, className }: AlertProps) {
  const Icon = tone === "error" ? TriangleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-snug",
        tone === "error"
          ? "border-danger/25 bg-danger-soft text-danger"
          : "border-success/25 bg-success-soft text-success",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-px size-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

/** Renders the outcome of an auth action, or an error code passed in the URL. */
export function FormStateAlert({
  state,
  initialError,
}: {
  state: AuthFormState;
  initialError?: AuthErrorCode;
}) {
  if (state.status === "success") {
    return <FormAlert tone="success">{AUTH_NOTICES[state.notice]}</FormAlert>;
  }
  const code = state.status === "error" ? state.code : initialError;
  // Field-level problems are shown next to the fields themselves.
  if (!code || (state.status === "error" && code === "invalid_input" && state.fields)) return null;
  return <FormAlert tone="error">{AUTH_ERROR_MESSAGES[code]}</FormAlert>;
}

/**
 * Cloudflare Turnstile widget. Writes its token into a hidden `captchaToken`
 * field that Supabase Auth verifies server-side. Renders nothing when no site
 * key is configured (local development with CAPTCHA switched off).
 *
 * Tokens are single-use: give this component a new `key` after every submit so
 * it remounts and fetches a fresh one.
 */
export function CaptchaField() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const [token, setToken] = useState("");

  if (!siteKey) return null;

  return (
    <div className="min-h-[65px]">
      <input type="hidden" name="captchaToken" value={token} />
      <Turnstile
        siteKey={siteKey}
        options={{ theme: "dark", size: "flexible", responseField: false }}
        onSuccess={setToken}
        onExpire={() => setToken("")}
        onError={() => setToken("")}
      />
    </div>
  );
}

export function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.9-5.35 3.9a6 6 0 1 1 0-12c1.5 0 2.85.55 3.9 1.45l2.15-2.15A9 9 0 1 0 12 21c5.2 0 8.9-3.65 8.9-8.8 0-.4-.05-.75-.1-1.1Z"
      />
    </svg>
  );
}

export function OrDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="font-mono text-[11px] tracking-wide text-subtle uppercase">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
