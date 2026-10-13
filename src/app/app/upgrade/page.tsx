import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authLinkClass } from "@/components/auth/auth-card";
import { UpgradeEmailForm, UpgradeGoogleButton } from "@/components/auth/auth-forms";
import { FormAlert, OrDivider } from "@/components/auth/form-parts";
import { AUTH_ERROR_MESSAGES, isAuthErrorCode } from "@/lib/auth/errors";
import { isGuest, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create your account" };

/*
 * Guest → account. Both paths attach an identity to the SAME user id, so every
 * saved piece stays where it is; the database then moves the plan from 'guest'
 * to 'free' by itself (trigger on auth.users).
 */
export default async function UpgradePage({ searchParams }: PageProps<"/app/upgrade">) {
  const user = await requireUser("/app/upgrade");
  if (!isGuest(user)) redirect("/app");

  const params = await searchParams;
  const error = isAuthErrorCode(params.error) ? params.error : undefined;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6 sm:p-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm leading-relaxed text-muted">
            Everything you made as a guest stays in your library. You&apos;ll move to the Free plan:
            5 generations a month, plus publishing.
          </p>
        </div>
        <div className="flex flex-col gap-5">
          {error ? <FormAlert tone="error">{AUTH_ERROR_MESSAGES[error]}</FormAlert> : null}
          <UpgradeGoogleButton />
          <OrDivider>or</OrDivider>
          <UpgradeEmailForm />
        </div>
      </div>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className={authLinkClass}>
          Log in
        </Link>{" "}
        instead — the guest session&apos;s content will not be moved.
      </p>
    </div>
  );
}
