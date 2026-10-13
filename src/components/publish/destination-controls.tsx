"use client";

import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/components/ui/toast";
import {
  addDiscordDestinationAction,
  removeDestinationAction,
  testDestinationAction,
} from "@/lib/publish/actions";
import { DESTINATION_LIMITS, normalizeDiscordWebhookUrl } from "@/lib/publish/destinations";
import type { PublishErrorCode } from "@/lib/publish/errors";

/** The form that connects a Discord channel by its webhook URL. */
export function AddDiscordForm() {
  const t = useTranslations("publish");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<PublishErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const name = label.replace(/\s+/g, " ").trim();
  const nameError =
    touched && (name === "" || name.length > DESTINATION_LIMITS.labelMax)
      ? t("destinations.nameRequired", { max: DESTINATION_LIMITS.labelMax })
      : undefined;
  const urlError =
    touched && normalizeDiscordWebhookUrl(url) === null ? t("destinations.urlInvalid") : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (name === "" || name.length > DESTINATION_LIMITS.labelMax) return;
    if (normalizeDiscordWebhookUrl(url) === null) return;

    startTransition(async () => {
      try {
        const result = await addDiscordDestinationAction({ label: name, webhookUrl: url });
        if (!result.ok) {
          setError(result.code);
          return;
        }
        // The URL leaves the page as soon as it is stored; from here on it is only shown masked.
        setLabel("");
        setUrl("");
        setTouched(false);
        toast.success(t("destinations.added"));
      } catch {
        setError("network_error");
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error ? <FormAlert tone="error">{t(`errors.${error}`)}</FormAlert> : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Field label={t("destinations.nameLabel")} error={nameError}>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("destinations.namePlaceholder")}
            maxLength={DESTINATION_LIMITS.labelMax * 2}
            autoComplete="off"
          />
        </Field>
        <Field label={t("destinations.urlLabel")} hint={t("destinations.urlHint")} error={urlError}>
          <Input
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t("destinations.urlPlaceholder")}
            maxLength={400}
            // A webhook URL is a credential: keep it out of autofill and spell-check services.
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-[13px]"
          />
        </Field>
      </div>

      <div>
        <Button type="submit" variant="secondary" loading={pending}>
          {pending ? null : <Plus aria-hidden="true" />}
          {t("destinations.add")}
        </Button>
      </div>
    </form>
  );
}

/** "Send test message" and "Remove" for one Discord destination. */
export function DestinationActions({ id, label }: { id: string; label: string }) {
  const t = useTranslations("publish");
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function test() {
    startTest(async () => {
      try {
        const result = await testDestinationAction({ id });
        if (!result.ok) toast.error(t(`errors.${result.code}`));
        else if (result.simulated) toast.info(t("destinations.testSimulated"));
        else toast.success(t("destinations.testSent"));
      } catch {
        toast.error(t("errors.network_error"));
      }
    });
  }

  function remove() {
    startRemove(async () => {
      try {
        const result = await removeDestinationAction({ id });
        if (!result.ok) {
          toast.error(t(`errors.${result.code}`));
          return;
        }
        setConfirm(false);
        toast.success(t("destinations.removed"));
      } catch {
        toast.error(t("errors.network_error"));
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={test}
        loading={testing}
        aria-label={t("destinations.testFor", { label })}
      >
        {testing ? null : <FlaskConical aria-hidden="true" />}
        {t("destinations.test")}
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => setConfirm(true)}
        aria-label={t("destinations.removeFor", { label })}
      >
        <Trash2 aria-hidden="true" />
        {t("destinations.remove")}
      </Button>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent closeLabel={t("destinations.removeDialog.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("destinations.removeDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("destinations.removeDialog.description", { label })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("destinations.removeDialog.cancel")}</Button>
            </DialogClose>
            <Button variant="danger" onClick={remove} loading={removing}>
              {t("destinations.removeDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
