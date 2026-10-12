import type { Metadata } from "next";
import Link from "next/link";

import { StatusScreen } from "@/components/layout/status-screen";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="This page fanned out into nothing."
      description="The link may be broken, or the page may have moved. Head back and try again."
    >
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </StatusScreen>
  );
}
