import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getAppContext } from "@/lib/auth/session";
import { getRecentContent } from "@/lib/dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

export default async function DashboardPage() {
  const context = await getAppContext("/app");
  // The layout renders the "waking up" / load-error screen in this case.
  if (!context) return null;

  const recent = await getRecentContent();

  return <DashboardView account={context.account} guest={context.guest} recent={recent} />;
}
