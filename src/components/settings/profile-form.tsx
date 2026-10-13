"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { FormAlert, SubmitButton } from "@/components/auth/form-parts";
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
import { APP_LOCALES, INTL_LOCALE } from "@/i18n/config";
import { TONES } from "@/lib/presets";
import { updateProfileAction } from "@/lib/profile/actions";
import type { ProfileFormState, ProfileUpdate } from "@/lib/profile/schema";

const IDLE: ProfileFormState = { status: "idle" };

type ProfileFormProps = {
  /** Account email, or null for a guest session. */
  email: string | null;
  initial: Omit<ProfileUpdate, "display_name"> & { display_name: string };
};

export function ProfileForm({ email, initial }: ProfileFormProps) {
  const t = useTranslations();
  const [state, action] = useActionState(updateProfileAction, IDLE);

  // Controlled, because React resets uncontrolled fields after a form action.
  const [values, setValues] = useState(initial);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const savedAt = state.status === "success" ? state.at : null;
  useEffect(() => {
    if (savedAt) toast.success(t("settings.profile.saved"));
  }, [savedAt, t]);

  const nameTooLong = values.display_name.trim().length > 80;
  const nameError =
    nameTooLong || (state.status === "error" && state.nameTooLong)
      ? t("settings.profile.errors.name_too_long")
      : undefined;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.status === "error" && !(state.code === "invalid_input" && state.nameTooLong) ? (
        <FormAlert tone="error">{t(`settings.profile.errors.${state.code}`)}</FormAlert>
      ) : null}

      <Field label={t("settings.profile.email")}>
        <Input value={email ?? t("settings.profile.guestEmail")} readOnly disabled />
      </Field>

      <Field
        label={t("settings.profile.displayName")}
        hint={t("settings.profile.displayNameHint")}
        error={nameError}
        aside={`${values.display_name.trim().length}/80`}
      >
        <Input
          name="display_name"
          autoComplete="name"
          value={values.display_name}
          onChange={(event) => set("display_name", event.target.value)}
          placeholder={t("settings.profile.displayNamePlaceholder")}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("settings.profile.uiLanguage")} hint={t("settings.profile.uiLanguageHint")}>
          <Select
            name="ui_language"
            value={values.ui_language}
            onValueChange={(value) => set("ui_language", value as ProfileUpdate["ui_language"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale} lang={INTL_LOCALE[locale]}>
                  {t(`common.languages.${locale}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={t("settings.profile.contentLanguage")}
          hint={t("settings.profile.contentLanguageHint")}
        >
          <Select
            name="default_content_language"
            value={values.default_content_language}
            onValueChange={(value) =>
              set("default_content_language", value as ProfileUpdate["default_content_language"])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {t(`common.languages.${locale}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("settings.profile.tone")}>
          <Select
            name="default_tone"
            value={values.default_tone}
            onValueChange={(value) => set("default_tone", value as ProfileUpdate["default_tone"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((tone) => (
                <SelectItem key={tone} value={tone}>
                  {t(`common.tones.${tone}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div>
        <SubmitButton disabled={nameTooLong}>{t("settings.profile.submit")}</SubmitButton>
      </div>
    </form>
  );
}
