"use client";

import { ExternalLink, RotateCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useNow, useTimeZone, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  cancelPublishJobAction,
  retryPublishJobAction,
  updatePublishJobAction,
} from "@/lib/publish/actions";
import type { DestinationView } from "@/lib/publish/destinations";
import type { PublishErrorCode } from "@/lib/publish/errors";
import { PUBLISH_LIMITS, type JobView } from "@/lib/publish/schema";
import { DEFAULT_TIME_ZONE, fromLocalInput, toLocalInput } from "@/lib/publish/time";

import { JobStatusBadge, SimulatedBadge, useDestinationName, useFailureText } from "./job-status";

export type JobDialogProps = {
  job: JobView;
  /** The user's Discord destinations, for "change destination". */
  destinations: readonly DestinationView[];
  /** The account's address, and whether email can be chosen (it must be verified). */
  email: string | null;
  emailVerified: boolean;
  onClose(): void;
};

const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  );
}

/**
 * Everything about one publish job (spec §4.5): where and when, the attempt
 * log, and what can still be done with it — reschedule or cancel while it
 * waits, retry once it has failed.
 */
export function JobDialog({ job, destinations, email, emailVerified, onClose }: JobDialogProps) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const failureText = useFailureText();
  const destinationName = useDestinationName();

  const initialTime = toLocalInput(new Date(job.scheduledAt), timeZone);
  const initialDestination = job.destination.kind === "email" ? "email" : job.destination.id;

  const [time, setTime] = useState(initialTime);
  const [destination, setDestination] = useState(initialDestination);
  const [error, setError] = useState<PublishErrorCode | null>(null);
  const [working, startWork] = useTransition();

  const instant = fromLocalInput(time, timeZone);
  const timeChanged = time !== initialTime;
  const destinationChanged = destination !== initialDestination;
  const timeError = !timeChanged
    ? undefined
    : !instant
      ? t("publish.dialog.timeRequired")
      : instant.getTime() <= now.getTime()
        ? t("publish.dialog.timePast")
        : undefined;

  const failure = job.status === "failed" ? failureText(job.lastError) : null;
  const retriesLeft = job.attempts < PUBLISH_LIMITS.maxAttempts;

  /** Runs an action; on success shows `done` and closes. */
  function run(
    action: () => Promise<{ ok: true } | { ok: false; code: PublishErrorCode }>,
    done: string,
  ) {
    setError(null);
    startWork(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setError(result.code);
          return;
        }
        toast.success(done);
        onClose();
      } catch {
        setError("network_error");
      }
    });
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (timeError || (!timeChanged && !destinationChanged)) return;
    run(
      () =>
        updatePublishJobAction({
          jobId: job.id,
          scheduledAt: timeChanged && instant ? instant.toISOString() : null,
          destination: destinationChanged ? destination : null,
        }),
      t("calendar.job.saved"),
    );
  }

  function retry() {
    setError(null);
    startWork(async () => {
      try {
        const result = await retryPublishJobAction({ jobId: job.id });
        if (!result.ok) {
          setError(result.code);
          return;
        }
        if (result.status === "failed") {
          toast.error(
            t("publish.dialog.toasts.failed", {
              reason: failureText(result.error) ?? t("publish.failures.delivery_failed"),
            }),
          );
        } else if (result.status === "published") {
          toast.success(
            t(
              result.simulated
                ? "publish.dialog.toasts.publishedSimulated"
                : "publish.dialog.toasts.published",
            ),
          );
        } else {
          toast.info(t("publish.dialog.toasts.processing"));
        }
        onClose();
      } catch {
        setError("network_error");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t("common.close")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-words">{job.content.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <span className="sr-only">{t("calendar.job.dialogTitle")}</span>
              <JobStatusBadge status={job.status} />
              {job.simulated ? <SimulatedBadge /> : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        {error ? <FormAlert tone="error">{t(`publish.errors.${error}`)}</FormAlert> : null}

        <dl>
          <Detail label={t("calendar.job.piece")}>
            <Link
              href={`/app/library/${job.content.id}` as Route}
              className="inline-flex items-center gap-1.5 rounded-sm text-accent underline-offset-4 hover:underline"
            >
              {t(`common.formats.${job.content.type}`)} · {t("calendar.job.openPiece")}
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </Link>
          </Detail>
          <Detail label={t("calendar.job.destination")}>{destinationName(job.destination)}</Detail>
          <Detail label={t("calendar.job.scheduledFor")}>
            {format.dateTime(new Date(job.scheduledAt), DATE_TIME)}
          </Detail>
          {job.publishedAt ? (
            <Detail label={t("calendar.job.publishedAt")}>
              {format.dateTime(new Date(job.publishedAt), DATE_TIME)}
            </Detail>
          ) : null}
          <Detail label={t("calendar.job.attemptCount")}>
            <span className="counter">
              {t("calendar.job.attemptCountValue", {
                used: job.attempts,
                max: PUBLISH_LIMITS.maxAttempts,
              })}
            </span>
          </Detail>
        </dl>

        {job.status === "processing" ? (
          <p className="text-[13px] leading-snug text-muted">{t("calendar.job.processingHint")}</p>
        ) : null}
        {job.status === "cancelled" ? (
          <p className="text-[13px] leading-snug text-muted">{t("calendar.job.cancelledHint")}</p>
        ) : null}

        {job.status === "failed" ? (
          <section aria-labelledby="job-error" className="flex flex-col gap-3">
            <h3 id="job-error" className="text-sm font-semibold">
              {t("calendar.job.error")}
            </h3>
            <FormAlert tone="error">{failure ?? t("publish.failures.delivery_failed")}</FormAlert>
            {retriesLeft ? null : (
              <p className="text-[13px] leading-snug text-muted">
                {t("calendar.job.noRetriesLeft", { max: PUBLISH_LIMITS.maxAttempts })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {retriesLeft ? (
                <Button onClick={retry} loading={working}>
                  {working ? null : <RotateCw aria-hidden="true" />}
                  {t("calendar.job.retry")}
                </Button>
              ) : null}
              {/* Takes it off the "Needs attention" list; the attempt log is kept. */}
              <Button
                variant="secondary"
                disabled={working}
                onClick={() =>
                  run(() => cancelPublishJobAction({ jobId: job.id }), t("calendar.job.dismissed"))
                }
              >
                {t("calendar.job.dismiss")}
              </Button>
            </div>
          </section>
        ) : null}

        {job.status === "scheduled" ? (
          <form
            onSubmit={save}
            aria-labelledby="job-reschedule"
            className="flex flex-col gap-4 border-t border-border pt-5"
            noValidate
          >
            <h3 id="job-reschedule" className="text-sm font-semibold">
              {t("calendar.job.reschedule")}
            </h3>
            <Field
              label={t("publish.dialog.timeLabel")}
              hint={t("publish.dialog.timeHint", { timeZone })}
              error={timeError}
            >
              <Input
                type="datetime-local"
                value={time}
                min={toLocalInput(now, timeZone)}
                onChange={(event) => setTime(event.target.value)}
                className="[color-scheme:dark]"
              />
            </Field>
            <Field label={t("publish.dialog.destinationLabel")}>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="email"
                    disabled={!emailVerified && initialDestination !== "email"}
                  >
                    {email ? t("publish.emailTo", { email }) : t("publish.emailToAccount")}
                  </SelectItem>
                  {destinations.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {t("publish.kinds.discord")} · {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="danger"
                disabled={working}
                onClick={() =>
                  run(() => cancelPublishJobAction({ jobId: job.id }), t("calendar.job.cancelled"))
                }
              >
                {t("calendar.job.cancelJob")}
              </Button>
              <Button
                type="submit"
                loading={working}
                disabled={Boolean(timeError) || (!timeChanged && !destinationChanged)}
              >
                {t("calendar.job.save")}
              </Button>
            </div>
          </form>
        ) : null}

        <section aria-labelledby="job-attempts" className="flex flex-col gap-3">
          <h3 id="job-attempts" className="text-sm font-semibold">
            {t("calendar.job.attemptsTitle")}
          </h3>
          {job.attemptsLog.length === 0 ? (
            <p className="text-[13px] leading-snug text-muted">{t("calendar.job.noAttempts")}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
              {job.attemptsLog.map((attempt, index) => (
                <li key={attempt.id} className="flex flex-col gap-0.5 px-3 py-2.5 text-[13px]">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">
                      {t("calendar.job.attempt", { number: index + 1 })}
                    </span>
                    <span className="counter text-xs text-muted">
                      {format.dateTime(new Date(attempt.startedAt), DATE_TIME)}
                    </span>
                  </p>
                  <p
                    className={
                      attempt.ok === null
                        ? "text-warn"
                        : attempt.ok
                          ? "text-success"
                          : "text-danger"
                    }
                  >
                    {attempt.ok === null
                      ? t("calendar.job.attemptRunning")
                      : attempt.ok
                        ? t("calendar.job.attemptOk")
                        : `${t("calendar.job.attemptFailed")} — ${failureText(attempt.detail) ?? t("publish.failures.delivery_failed")}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
