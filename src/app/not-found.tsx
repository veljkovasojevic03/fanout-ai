import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { StatusScreen } from "@/components/layout/status-screen";
import { Button } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notFound");
  return { title: t("metaTitle") };
}

export default async function NotFound() {
  const t = await getTranslations();

  return (
    <StatusScreen code="404" title={t("notFound.title")} description={t("notFound.description")}>
      <Button asChild>
        <Link href="/">{t("common.backHome")}</Link>
      </Button>
    </StatusScreen>
  );
}
