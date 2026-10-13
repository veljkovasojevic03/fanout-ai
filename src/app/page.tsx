import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Wordmark } from "@/components/brand/wordmark";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { CONTENT_TYPES } from "@/lib/presets";

/*
 * Foundation placeholder. The real landing page with the interactive
 * Sample-mode demo replaces this in Phase 7.
 */
export default async function HomePage() {
  const [t, user] = await Promise.all([getTranslations(), getCurrentUser()]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-1/2 h-[420px] w-[640px] max-w-full -translate-x-1/2 glow-accent"
      />

      <header className="relative z-10 flex items-center justify-between gap-3 px-6 py-5">
        <Wordmark />
        <div className="flex items-center gap-3">
          <Badge variant="warn" dot className="hidden sm:inline-flex">
            {t("home.status")}
          </Badge>
          <LanguageSwitcher />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24">
        <div className="flex max-w-2xl flex-col items-center gap-7 text-center">
          <h1 className="text-5xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-7xl">
            {t("common.taglineLead")}
            <br />
            <span className="text-accent">{t("common.taglineAccent")}</span>
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted">{t("home.lead")}</p>
          <ul className="flex flex-wrap justify-center gap-2" aria-label={t("home.formatsLabel")}>
            {CONTENT_TYPES.map((type) => (
              <li key={type}>
                <Badge>{t(`common.formats.${type}`)}</Badge>
              </li>
            ))}
          </ul>
          <p className="max-w-md text-sm leading-relaxed text-subtle">{t("home.note")}</p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {user ? (
              <Button asChild size="lg">
                <Link href="/app">
                  {t("home.openApp")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/guest">
                    {t("home.tryGuest")}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/signup">{t("home.signUp")}</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/login">{t("home.logIn")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
