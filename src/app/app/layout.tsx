import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { WakingUp } from "@/components/shell/waking-up";
import { getAccount, getSessionState, isGuest, loginPath } from "@/lib/auth/session";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/*
 * Gatekeeper for the authenticated area.
 *
 * The proxy already redirects signed-out visitors, but this layout verifies the
 * user with the Auth server itself: the proxy is an optimisation, this check is
 * the guarantee. It also picks between the three non-happy screens — login,
 * "waking up" (backend unreachable) and "couldn't load your workspace".
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionState();
  if (session.status === "signed_out") redirect(loginPath("/app"));
  if (session.status === "unavailable") return <WakingUp />;

  const { user } = session;
  const result = await getAccount(user.id);
  if (!result.ok && result.reason === "unavailable") return <WakingUp />;

  return (
    <AppShell
      account={result.ok ? result.account : null}
      email={user.email ?? null}
      guest={isGuest(user)}
    >
      {children}
    </AppShell>
  );
}
