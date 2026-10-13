import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard, authLink } from "@/components/auth/auth-card";
import { GoogleButton, SignupForm } from "@/components/auth/auth-forms";
import { OrDivider } from "@/components/auth/form-parts";
import { getCurrentUser, isGuest } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: t("metaTitle") };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  const user = await getCurrentUser();
  // A guest "signing up" should upgrade in place, so their saved content comes along.
  if (user) redirect(isGuest(user) ? "/app/upgrade" : "/app");

  const t = await getTranslations("auth.signup");

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <p>{t.rich("haveAccount", { link: authLink("/login") })}</p>
          <p>{t.rich("justLooking", { link: authLink("/guest") })}</p>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <GoogleButton next={next} mode="signUp" />
        <OrDivider />
        <SignupForm next={next} />
      </div>
    </AuthCard>
  );
}
