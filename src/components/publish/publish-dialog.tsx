"use client";

import { ArrowRight, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTimeZone, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createPublishJobAction, getPublishOptionsAction } from "@/lib/publish/actions";
import type { PublishOptions } from "@/lib/publish/actions";
import type { PublishErrorCode } from "@/lib/publish/errors";
import { PUBLISH_LIMITS } from "@/lib/publish/schema";
import { DEFAULT_TIME_ZONE, fromLocalInput, toLocalInput } from "@/lib/publish/time";

import { SimulatedBadge, useFailureText } from "./job-status";

type PublishButtonProps = Pick<ButtonProps, "variant" | "size" | "className"> & {
  contentId: string;
  /** The piece's title, for the dialog and for the button's accessible name. */
  title: string;
  /** Guests see an "Upgrade to publish" state instead of the form (spec Phase 6.2). */
  guest: boolean;
  /** Icon only, for rows in a list. The title then becomes the accessible name. */
  iconOnly?: boolean;
  /**
   * Runs before the request, e.g. to flush an autosave: what is published is
   * the saved version. Resolving to false stops the submit.
   */
  beforeSubmit?: () => Promise<boolean>;
};

/** "Publish" button with its dialog: publish now, or schedule for later (spec §4.5). */
export function PublishButton({
  contentId,
  title,
  guest,
  iconOnly = false,
  beforeSubmit,
  variant = "secondary",
  size = "sm",
  className,
}: PublishButtonProps) {
  const t = useTranslations("publish.dialog");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
        aria-label={iconOnly ? t("triggerFor", { title }) : undefined}
        title={iconOnly ? t("trigger") : undefined}
      >
        <Send aria-hidden="true" />
        {iconOnly ? null : t("trigger")}
      </Button>
      {/* Mounted only while open, so every opening starts from a clean form. */}
      {open ? (
        <PublishDialog
          contentId={contentId}
          title={title}
          guest={guest}
          beforeSubmit={beforeSubmit}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type Loaded =
  | { status: "loading" }
  | { status: "error"; code: PublishErrorCode }
  | { status: "ready"; options: PublishOptions };

type PublishDialogProps = Pick<
  PublishButtonProps,
  "contentId" | "title" | "guest" | "beforeSubmit"
> & {
  onClose(): void;
  /** Skips the request for the options. Used by `/design` to show the form without a session. */
  initialOptions?: PublishOptions;
};

const FIVE_MINUTES = 5 * 60_000;

export function PublishDialog({
  contentId,
  title,
  guest,
  beforeSubmit,
  onClose,
  initialOptions,
}: PublishDialogProps) {
  const t = useTranslations("publish");
  const [loaded, setLoaded] = useState<Loaded>(
    initialOptions ? { status: "ready", options: initialOptions } : { status: "loading" },
  );

  useEffect(() => {
    if (guest || initialOptions) return;
    let cancelled = false;
    getPublishOptionsAction()
      .then((result) => {
        if (cancelled) return;
        setLoaded(
          result.ok
            ? { status: "ready", options: result.options }
            : { status: "error", code: result.code },
        );
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: "error", code: "network_error" });
      });
    return () => {
      cancelled = true;
    };
  }, [guest, initialOptions]);

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t("dialog.cancel")}>
        {guest ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("dialog.guestTitle")}</DialogTitle>
              <DialogDescription>{t("dialog.guestBody")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">{t("dialog.cancel")}</Button>
              </DialogClose>
              <Button asChild>
                <Link href="/app/upgrade">
                  {t("dialog.guestAction")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("dialog.title")}</DialogTitle>
              <DialogDescription>{t("dialog.description", { title })}</DialogDescription>
            </DialogHeader>

            {loaded.status === "loading" ? (
              <div aria-busy="true" className="flex flex-col gap-4">
                <span className="sr-only" role="status">
                  {t("dialog.loading")}
                </span>
                <Skeleton className="h-9.5 rounded-md" />
                <Skeleton className="h-8.5 w-40 rounded-md" />
                <Skeleton className="ml-auto h-9.5 w-32 rounded-md" />
              </div>
            ) : loaded.status === "error" ? (
              <>
                <FormAlert tone="error">{t(`errors.${loaded.code}`)}</FormAlert>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">{t("dialog.cancel")}</Button>
                  </DialogClose>
                </DialogFooter>
              </>
            ) : (
              <PublishForm
                contentId={contentId}
                options={loaded.options}
                beforeSubmit={beforeSubmit}
                onClose={onClose}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type PublishFormProps = Pick<PublishDialogProps, "contentId" | "beforeSubmit" | "onClose"> & {
  options: PublishOptions;
};

function PublishForm({ contentId, options, beforeSubmit, onClose }: PublishFormProps) {
  const t = useTranslations("publish");
  const format = useFormatter();
  const router = useRouter();
  const now = useNow();
  const timeZone = useTimeZone() ?? DEFAULT_TIME_ZONE;
  const failureText = useFailureText();

  const { destinations, emailVerified, email, mode } = options;
  const [destination, setDestination] = useState(
    emailVerified ? "email" : (destinations[0]?.id ?? ""),
  );
  const [when, setWhen] = useState<"now" | "later">("now");
  // Default: an hour from now, on a five-minute mark.
  const [time, setTime] = useState(() =>
    toLocalInput(
      new Date(Math.ceil((now.getTime() + 3_600_000) / FIVE_MINUTES) * FIVE_MINUTES),
      timeZone,
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instant = when === "later" ? fromLocalInput(time, timeZone) : null;
  const timeError =
    when !== "later"
      ? undefined
      : !instant
        ? t("dialog.timeRequired")
        : instant.getTime() <= now.getTime()
          ? t("dialog.timePast")
          : instant.getTime() > now.getTime() + PUBLISH_LIMITS.maxAheadDays * 86_400_000
            ? t("dialog.timeTooFar")
            : undefined;

  const viewCalendar = {
    label: t("dialog.viewCalendar"),
    onClick: () => router.push("/app/calendar"),
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || destination === "" || timeError) return;
    setPending(true);
    setError(null);
    try {
      if (beforeSubmit && !(await beforeSubmit())) {
        setError(t("dialog.saveFirst"));
        return;
      }
      const result = await createPublishJobAction({
        contentId,
        destination,
        scheduledAt: instant ? instant.toISOString() : null,
      });
      if (!result.ok) {
        setError(t(`errors.${result.code}`));
        return;
      }

      if (result.status === "scheduled" && instant) {
        toast.success(
          t("dialog.toasts.scheduled", {
            time: format.dateTime(instant, { dateStyle: "medium", timeStyle: "short" }),
          }),
          { action: viewCalendar },
        );
      } else if (result.status === "published") {
        toast.success(
          t(result.simulated ? "dialog.toasts.publishedSimulated" : "dialog.toasts.published"),
          { action: viewCalendar },
        );
      } else if (result.status === "failed") {
        toast.error(
          t("dialog.toasts.failed", {
            reason: failureText(result.error) ?? t("failures.delivery_failed"),
          }),
          { action: viewCalendar },
        );
      } else {
        toast.info(t("dialog.toasts.processing"), { action: viewCalendar });
      }
      onClose();
    } catch {
      setError(t("errors.network_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {mode === "simulated" ? (
        <p className="flex flex-col items-start gap-2 rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] leading-snug text-warn">
          <SimulatedBadge />
          {t("simulatedHint")}
        </p>
      ) : null}

      <Field
        label={t("dialog.destinationLabel")}
        hint={!emailVerified ? t("dialog.emailUnverified") : undefined}
        error={destination === "" ? t("dialog.noDestination") : undefined}
      >
        <Select value={destination} onValueChange={setDestination}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email" disabled={!emailVerified}>
              {email ? t("emailTo", { email }) : t("emailToAccount")}
            </SelectItem>
            {destinations.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t("kinds.discord")} · {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="flex flex-col gap-1.5">
        <span id="publish-when" className="text-[13px] leading-5 font-medium">
          {t("dialog.whenLabel")}
        </span>
        <ToggleGroup
          type="single"
          aria-labelledby="publish-when"
          value={when}
          // Radix reports "" when the active chip is pressed again; keep one selected.
          onValueChange={(value) => (value === "now" || value === "later" ? setWhen(value) : null)}
        >
          <ToggleGroupItem value="now">{t("dialog.now")}</ToggleGroupItem>
          <ToggleGroupItem value="later">{t("dialog.later")}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {when === "later" ? (
        <Field
          label={t("dialog.timeLabel")}
          hint={t("dialog.timeHint", { timeZone })}
          error={timeError}
        >
          <Input
            type="datetime-local"
            value={time}
            min={toLocalInput(now, timeZone)}
            onChange={(event) => setTime(event.target.value)}
            className="[color-scheme:dark]"
            required
          />
        </Field>
      ) : null}

      <p className="text-[13px] leading-snug text-muted">{t("dialog.versionHint")}</p>

      <DialogFooter>
        <Button asChild variant="ghost" className="sm:mr-auto">
          <Link href="/app/settings#destinations">{t("dialog.manage")}</Link>
        </Button>
        <DialogClose asChild>
          <Button variant="secondary">{t("dialog.cancel")}</Button>
        </DialogClose>
        <Button type="submit" loading={pending} disabled={destination === "" || Boolean(timeError)}>
          {t(when === "later" ? "dialog.submitLater" : "dialog.submitNow")}
        </Button>
      </DialogFooter>
    </form>
  );
}
