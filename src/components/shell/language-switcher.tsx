"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { setLocaleAction } from "@/i18n/actions";
import { APP_LOCALES, INTL_LOCALE, toAppLocale, type AppLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * EN | SR toggle. Works for everyone (cookie) and, for signed-in users, also
 * saves the choice to their profile. The codes themselves are not translated.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const current = toAppLocale(useLocale());
  const [pending, startTransition] = useTransition();

  function choose(locale: AppLocale) {
    if (locale === current || pending) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("shell.language.label")}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-8 items-center rounded-md border border-border bg-surface p-0.5",
        pending && "opacity-70",
        className,
      )}
    >
      {APP_LOCALES.map((locale) => {
        const active = locale === current;
        const name = t(`common.languages.${locale}`);
        return (
          <button
            key={locale}
            type="button"
            lang={INTL_LOCALE[locale]}
            aria-pressed={active}
            // Starts with the visible code, so voice control ("click EN") matches the name.
            aria-label={`${locale.toUpperCase()} — ${
              active ? name : t("shell.language.switchTo", { language: name })
            }`}
            onClick={() => choose(locale)}
            className={cn(
              "h-full rounded-[5px] px-2 font-mono text-[11px] font-medium tracking-wide uppercase transition-colors",
              active
                ? "bg-elevated text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
                : "text-muted hover:text-foreground",
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
