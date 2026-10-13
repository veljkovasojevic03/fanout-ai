import { ArrowRight, Inbox, Sparkles, TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getFormatter, getNow, getTranslations } from "next-intl/server";

import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { UsageMeter } from "@/components/ui/usage-meter";
import { nextResetDate, type Account } from "@/lib/auth/session";
import type { RecentContent } from "@/lib/dashboard";
import { PRESET_IDS, PRESETS } from "@/lib/presets";
function StatCard({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <p className="counter text-3xl font-medium tracking-tight">{value}</p>
        {children}
        <p className="mt-auto text-[13px] leading-snug text-muted">{hint}</p>
      </CardContent>
    </Card>
  );
}

export type DashboardViewProps = {
  account: Account;
  guest: boolean;
  /** null = the recent-content query failed; the section shows its own error. */
  recent: RecentContent | null;
};

/**
 * The dashboard, as a pure function of its data. The page loads the data; this
 * renders it — which also lets /design/shell show it with sample values.
 */
export async function DashboardView({ account, guest, recent }: DashboardViewProps) {
  const { limit, usage, profile } = account;
  const [t, format, now] = await Promise.all([getTranslations(), getFormatter(), getNow()]);
  const remaining = Math.max(limit.generations - usage.generations, 0);
  const greeting = guest
    ? t("dashboard.greetingGuest")
    : profile.display_name
      ? t("dashboard.greeting", { name: profile.display_name })
      : t("dashboard.greetingPlain");

  const generationsHint =
    limit.period === "lifetime"
      ? t("dashboard.stats.generationsLifetime")
      : `${t("dashboard.stats.generationsMonth")} · ${t("dashboard.stats.resets", {
          date: format.dateTime(nextResetDate(now), { day: "numeric", month: "long" }),
        })}`;

  return (
    <>
      <PageHeader
        title={greeting}
        description={t("dashboard.subtitle")}
        aside={
          <Button asChild>
            <Link href="/app/generate">
              <Sparkles aria-hidden="true" />
              {t("shell.nav.generate")}
            </Link>
          </Button>
        }
      />

      {guest ? (
        // The sidebar carries this call to action on desktop; small screens have no sidebar.
        <div className="mb-8 flex flex-col gap-3 rounded-xl border border-accent-ring bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between lg:hidden">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{t("shell.guestCta.title")}</p>
            <p className="text-[13px] leading-snug text-muted">{t("shell.guestCta.body")}</p>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href="/app/upgrade">
              {t("shell.guestCta.action")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-10">
        <section aria-label={t("shell.usage.label")} className="grid gap-4 md:grid-cols-3">
          <StatCard
            label={t("dashboard.stats.generations")}
            value={
              <>
                {format.number(usage.generations)}
                <span className="text-muted"> / {format.number(limit.generations)}</span>
              </>
            }
            hint={generationsHint}
          >
            <UsageMeter
              hideCount
              used={usage.generations}
              limit={limit.generations}
              label={t("shell.usage.meter", {
                used: usage.generations,
                limit: limit.generations,
              })}
            />
            <p className="text-[13px] text-foreground">
              {t("dashboard.stats.remaining", { count: remaining })}
            </p>
          </StatCard>

          <StatCard
            label={t("dashboard.stats.words")}
            value={format.number(usage.words)}
            hint={t("dashboard.stats.wordsAllTime", { count: usage.totalWords })}
          />

          <StatCard
            label={t("dashboard.stats.saved")}
            value={recent ? format.number(recent.total) : "—"}
            hint={t("dashboard.stats.savedHint")}
          />
        </section>

        <section aria-labelledby="presets-title" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="presets-title" className="text-lg font-semibold tracking-tight">
              {t("dashboard.presets.title")}
            </h2>
            <p className="text-sm text-muted">{t("dashboard.presets.description")}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {PRESET_IDS.map((id) => (
              <li key={id}>
                <Link
                  href={{ pathname: "/app/generate", query: { preset: id } }}
                  className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong hover:bg-elevated"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-semibold">
                      {t(`dashboard.presets.items.${id}.title`)}
                    </h3>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-subtle transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-accent"
                    />
                  </div>
                  <p className="text-sm leading-relaxed text-muted">
                    {t(`dashboard.presets.items.${id}.description`)}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {PRESETS[id].types.map((type) => (
                      <Badge key={type}>{t(`common.formats.${type}`)}</Badge>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="recent-title" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-title" className="text-lg font-semibold tracking-tight">
              {t("dashboard.recent.title")}
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/library">
                {t("dashboard.recent.openLibrary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          {recent === null ? (
            <EmptyState
              tone="danger"
              icon={<TriangleAlert />}
              title={t("dashboard.recent.errorTitle")}
              description={t("dashboard.recent.errorDescription")}
            />
          ) : recent.items.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title={t("dashboard.recent.emptyTitle")}
              description={t("dashboard.recent.emptyDescription")}
              action={
                <Button asChild size="sm">
                  <Link href="/app/generate">
                    <Sparkles aria-hidden="true" />
                    {t("dashboard.recent.emptyAction")}
                  </Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <ul className="divide-y divide-border">
                {recent.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/library/${item.id}` as Route}
                      className="flex items-center gap-3.5 rounded-[inherit] px-5 py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:-outline-offset-2"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
                        <ContentTypeIcon type={item.type} className="size-4" />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <span className="text-[13px] text-muted">
                          {t(`common.formats.${item.type}`)} ·{" "}
                          {t("dashboard.recent.words", { count: item.word_count })}
                        </span>
                      </span>
                      <span className="hidden shrink-0 text-[13px] text-muted sm:block">
                        {t("dashboard.recent.updated", {
                          time: format.relativeTime(new Date(item.updated_at), now),
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
