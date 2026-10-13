import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard, authLink, authLinkClass } from "@/components/auth/auth-card";
import { GoogleButton, LoginForm } from "@/components/auth/auth-forms";
import { OrDivider } from "@/components/auth/form-parts";
import { isAuthErrorCode } from "@/lib/auth/errors";
import { getCurrentUser, isGuest } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("metaTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const initialError = isAuthErrorCode(params.error) ? params.error : undefined;

  // Guests may still log in to an existing account; everyone else is already in.
  const user = await getCurrentUser();
  if (user && !isGuest(user)) redirect("/app");

  const t = await getTranslations("auth.login");

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <p>{t.rich("newHere", { link: authLink("/signup") })}</p>
          <p>{t.rich("justLooking", { link: authLink("/guest") })}</p>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <GoogleButton next={next} mode="continue" />
        <OrDivider />
        <LoginForm next={next} initialError={initialError} />
        <Link href="/reset-password" className={`${authLinkClass} self-center text-sm`}>
          {t("forgot")}
        </Link>
      </div>
    </AuthCard>
  );
}
