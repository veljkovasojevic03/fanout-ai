import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AuthCard, authLink } from "@/components/auth/auth-card";
import { GuestForm } from "@/components/auth/auth-forms";
import { getCurrentUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.guest");
  return { title: t("metaTitle") };
}

const INCLUDED = ["included1", "included2", "included3"] as const;
const NOT_INCLUDED = ["notIncluded1", "notIncluded2"] as const;

export default async function GuestPage() {
  if (await getCurrentUser()) redirect("/app");

  const t = await getTranslations("auth.guest");

  return (
    <AuthCard
      title={t("title")}
      description={t("description")}
      footer={<p>{t.rich("footer", { signup: authLink("/signup"), login: authLink("/login") })}</p>}
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2 text-sm">
          {INCLUDED.map((key) => (
            <li key={key} className="flex items-center gap-2.5">
              <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
              {t(key)}
            </li>
          ))}
          {NOT_INCLUDED.map((key) => (
            <li key={key} className="flex items-center gap-2.5 text-muted">
              <X aria-hidden="true" className="size-4 shrink-0 text-subtle" />
              <span>
                <span className="sr-only">{t("notIncludedPrefix")} </span>
                {t(key)}
              </span>
            </li>
          ))}
        </ul>
        <GuestForm />
      </div>
    </AuthCard>
  );
}
