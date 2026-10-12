"use client"; // Error boundaries must be Client Components

import Link from "next/link";
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
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Never render error.message: it can carry internal details. The digest is safe.
  return (
    <StatusScreen
      code="Error"
      title="Something went wrong."
      description="An unexpected error interrupted this page. Trying again usually fixes it."
      reference={error.digest}
    >
      <Button onClick={() => retry()}>Try again</Button>
      <Button asChild variant="secondary">
        <Link href="/">Back to home</Link>
      </Button>
    </StatusScreen>
  );
}
