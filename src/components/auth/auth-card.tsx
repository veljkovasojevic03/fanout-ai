import { Settings } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/empty-state";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type AuthCardProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Secondary links under the card (e.g. "Already have an account?"). */
  footer?: React.ReactNode;
};

/** The card every auth screen is built from. */
export async function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6 sm:p-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm leading-relaxed text-muted">{description}</p> : null}
        </div>
        {isSupabaseConfigured() ? children : <NotConfigured />}
      </div>
      {footer ? (
        <div className="flex flex-col items-center gap-2 text-center text-sm text-muted">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/** Shown instead of a form when the Supabase env vars are missing. */
async function NotConfigured() {
  const t = await getTranslations("auth.notConfigured");
  return (
    <EmptyState
      icon={<Settings />}
      title={t("title")}
      description={t("description")}
      className="px-4 py-8"
    />
  );
}

export const authLinkClass =
  "rounded-sm font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:text-accent hover:decoration-accent";

/** Builds the renderer for a `<link>…</link>` tag in a translated message. */
export function authLink(href: Route) {
  const AuthLink = (chunks: React.ReactNode) => (
    <Link href={href} className={authLinkClass}>
      {chunks}
    </Link>
  );
  return AuthLink;
}
