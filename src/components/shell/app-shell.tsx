import { ArrowRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { FanoutMark, Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { UsageMeter } from "@/components/ui/usage-meter";
import type { Account } from "@/lib/auth/session";

import { LanguageSwitcher } from "./language-switcher";
import { BottomNav, SidebarNav } from "./nav";
import { UserMenu } from "./user-menu";

const PLAN_VARIANT = { guest: "neutral", free: "accent", pro: "solid" } as const;

type AppShellProps = {
  /** null = the account could not be loaded; the shell shows an error instead of the page. */
  account: Account | null;
  email: string | null;
  guest: boolean;
  children: React.ReactNode;
};

/**
 * The frame around every authenticated page: sidebar on desktop, top bar with
 * usage meter / plan badge / language / account menu, bottom tabs on mobile.
 * Purely presentational — who the user is gets decided by the /app layout.
 */
export async function AppShell({ account, email, guest, children }: AppShellProps) {
  const t = await getTranslations();

  return (
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
      >
        {t("common.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface/40 lg:flex">
        <div className="flex h-14 items-center px-5">
          <Link href="/app" className="inline-flex rounded-sm">
            <Wordmark />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <SidebarNav />
        </div>
        {guest ? (
          <div className="m-3 flex flex-col gap-3 rounded-lg border border-accent-ring bg-accent-soft p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{t("shell.guestCta.title")}</p>
              <p className="text-[13px] leading-snug text-muted">{t("shell.guestCta.body")}</p>
            </div>
            <Button asChild size="sm">
              <Link href="/app/upgrade">
                {t("shell.guestCta.action")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        ) : null}
      </aside>

      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link href="/app" className="inline-flex rounded-sm lg:hidden" aria-label="Fanout AI">
            <FanoutMark className="size-6" />
          </Link>
          <div className="flex-1" />
          {account ? (
            <>
              <div className="flex items-center gap-2.5">
                <span className="hidden text-xs text-muted md:inline">
                  {t("shell.usage.label")}
                </span>
                <UsageMeter
                  size="sm"
                  className="w-24 sm:w-32"
                  used={account.usage.generations}
                  limit={account.limit.generations}
                  label={t("shell.usage.meter", {
                    used: account.usage.generations,
                    limit: account.limit.generations,
                  })}
                />
              </div>
              <Badge variant={PLAN_VARIANT[account.profile.plan]}>
                {t(`common.plans.${account.profile.plan}`)}
              </Badge>
            </>
          ) : null}
          <LanguageSwitcher />
          <UserMenu name={account?.profile.display_name ?? null} email={email} guest={guest} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl px-4 pt-8 pb-28 sm:px-6 lg:pb-12">
        {account ? (
          children
        ) : (
          <EmptyState
            tone="danger"
            icon={<TriangleAlert />}
            title={t("shell.loadError.title")}
            description={t("shell.loadError.description")}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/app">{t("common.tryAgain")}</Link>
              </Button>
            }
          />
        )}
      </main>

      <BottomNav />
    </div>
  );
}
