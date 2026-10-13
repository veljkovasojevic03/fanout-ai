import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getAppContext } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calendar");
  return { title: t("metaTitle") };
}

// Scheduling and publishing are Phase 6. This page says so plainly.
export default async function CalendarPage() {
  const context = await getAppContext("/app/calendar");
  if (!context) return null;

  const t = await getTranslations();

  return (
    <>
      <PageHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        aside={<Badge variant="warn">{t("common.notBuiltYet")}</Badge>}
      />
      <EmptyState
        icon={<CalendarDays />}
        title={t("calendar.emptyTitle")}
        description={t("calendar.emptyDescription")}
      />
    </>
  );
}
