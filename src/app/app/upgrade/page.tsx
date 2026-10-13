import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { authLink } from "@/components/auth/auth-card";
import { UpgradeEmailForm, UpgradeGoogleButton } from "@/components/auth/auth-forms";
import { FormAlert, OrDivider } from "@/components/auth/form-parts";
import { isAuthErrorCode } from "@/lib/auth/errors";
import { getAppContext } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.upgrade");
  return { title: t("metaTitle") };
}

/*
 * Guest → account. Both paths attach an identity to the SAME user id, so every
 * saved piece stays where it is; the database then moves the plan from 'guest'
 * to 'free' by itself (trigger on auth.users).
 */
export default async function UpgradePage({ searchParams }: PageProps<"/app/upgrade">) {
  const context = await getAppContext("/app/upgrade");
  if (!context) return null;
  if (!context.guest) redirect("/app");

  const [t, params] = await Promise.all([getTranslations("auth"), searchParams]);
  const error = isAuthErrorCode(params.error) ? params.error : undefined;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6 sm:p-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("upgrade.title")}</h1>
          <p className="text-sm leading-relaxed text-muted">{t("upgrade.description")}</p>
        </div>
        <div className="flex flex-col gap-5">
          {error ? <FormAlert tone="error">{t(`errors.${error}`)}</FormAlert> : null}
          <UpgradeGoogleButton />
          <OrDivider />
          <UpgradeEmailForm />
        </div>
      </div>
      <p className="text-center text-sm leading-relaxed text-muted">
        {t.rich("upgrade.footer", { link: authLink("/login") })}
      </p>
    </div>
  );
}
