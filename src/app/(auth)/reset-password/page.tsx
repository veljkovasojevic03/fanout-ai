import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AuthCard, authLink } from "@/components/auth/auth-card";
import { ResetRequestForm } from "@/components/auth/auth-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.reset");
  return { title: t("metaTitle") };
}

export default async function ResetPasswordPage() {
  const t = await getTranslations("auth.reset");

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={<p>{t.rich("footer", { link: authLink("/login") })}</p>}
    >
      <ResetRequestForm />
    </AuthCard>
  );
}
