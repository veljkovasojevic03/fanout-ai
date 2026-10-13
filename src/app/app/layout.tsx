import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/auth/form-parts";
import { Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { signOutAction } from "@/lib/auth/actions";
import { getAccount, isGuest, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const PLAN_LABEL = { guest: "Guest", free: "Free", pro: "Pro" } as const;
const PLAN_VARIANT = { guest: "neutral", free: "accent", pro: "solid" } as const;

/*
 * Protected area. The proxy already redirects signed-out visitors, but this
 * layout verifies the user with the Auth server itself: the proxy is an
 * optimisation, this check is the guarantee.
 *
 * Minimal frame for now — the full app shell (sidebar, usage meter, language
 * switcher) replaces this header in Phase 2.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/app");
  const account = await getAccount(user.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/app" className="inline-flex rounded-sm">
            <Wordmark />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            {account ? (
              <Badge variant={PLAN_VARIANT[account.profile.plan]}>
                {PLAN_LABEL[account.profile.plan]}
              </Badge>
            ) : null}
            <span className="hidden truncate text-sm text-muted sm:inline">
              {isGuest(user) ? "Guest session" : (user.email ?? "")}
            </span>
            <form action={signOutAction}>
              <SubmitButton variant="ghost" size="sm">
                <LogOut aria-hidden="true" />
                {isGuest(user) ? "End session" : "Log out"}
              </SubmitButton>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">{children}</main>
    </div>
  );
}
