import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { DestinationView } from "@/lib/publish/destinations";
import { parseFailure } from "@/lib/publish/errors";
import type { JobStatus } from "@/lib/publish/schema";

const STATUS_VARIANT = {
  scheduled: "accent",
  processing: "warn",
  published: "success",
  failed: "danger",
  cancelled: "neutral",
} as const satisfies Record<JobStatus, string>;

/** The classes of a calendar chip, per status. Never the only signal: the status is also in its label. */
export const STATUS_CHIP: Record<JobStatus, string> = {
  scheduled: "border-accent-ring bg-accent-soft text-accent",
  processing: "border-warn/25 bg-warn-soft text-warn",
  published: "border-success/25 bg-success-soft text-success",
  failed: "border-danger/25 bg-danger-soft text-danger",
  cancelled: "border-border bg-white/[0.04] text-muted line-through",
};

export const STATUS_DOT: Record<JobStatus, string> = {
  scheduled: "bg-accent",
  processing: "bg-warn",
  published: "bg-success",
  failed: "bg-danger",
  cancelled: "bg-subtle",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const t = useTranslations("publish.statuses");
  return (
    <Badge variant={STATUS_VARIANT[status]} dot>
      {t(status)}
    </Badge>
  );
}

/** Marks anything that went through the simulated dispatcher (spec §4.5). */
export function SimulatedBadge() {
  const t = useTranslations("publish");
  return (
    <Badge variant="warn" title={t("simulatedHint")}>
      {t("simulated")}
    </Badge>
  );
}

/** Turns a stored failure code (`delivery_failed:429`) into a sentence. */
export function useFailureText() {
  const t = useTranslations("publish");
  return (stored: string | null | undefined): string | null => {
    const failure = parseFailure(stored);
    if (!failure) return null;
    const reason = t(`failures.${failure.code}`);
    return failure.httpStatus
      ? t("failureWithStatus", { reason, status: failure.httpStatus })
      : reason;
  };
}

/** What a destination is called in the UI: the email one has no name of its own. */
export function useDestinationName() {
  const t = useTranslations("publish.kinds");
  return (destination: Pick<DestinationView, "kind" | "label">): string =>
    destination.kind === "email" ? t("email") : destination.label;
}
