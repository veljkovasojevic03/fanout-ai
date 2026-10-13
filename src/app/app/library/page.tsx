import { Library } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getAppContext } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("metaTitle") };
}

// The library (search, tags, editor, export) is Phase 4. This page says so plainly.
export default async function LibraryPage() {
  const context = await getAppContext("/app/library");
  if (!context) return null;

  const t = await getTranslations();

  return (
    <>
      <PageHeader
        title={t("library.title")}
        description={t("library.description")}
        aside={<Badge variant="warn">{t("common.notBuiltYet")}</Badge>}
      />
      <EmptyState
        icon={<Library />}
        title={t("library.emptyTitle")}
        description={t("library.emptyDescription")}
      />
    </>
  );
}
