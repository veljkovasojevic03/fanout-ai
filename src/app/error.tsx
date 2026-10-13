"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { StatusScreen } from "@/components/layout/status-screen";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // Never render error.message: it can carry internal details. The digest is safe.
  return (
    <StatusScreen
      code={t("error.code")}
      title={t("error.title")}
      description={t("error.description")}
      reference={error.digest ? t("error.reference", { id: error.digest }) : undefined}
    >
      <Button onClick={() => retry()}>{t("common.tryAgain")}</Button>
      <Button asChild variant="secondary">
        <Link href="/">{t("common.backHome")}</Link>
      </Button>
    </StatusScreen>
  );
}
