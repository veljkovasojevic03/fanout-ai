import { ArrowRight, TriangleAlert, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getAccount, isGuest, requireUser, type Account } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Workspace" };

const LENGTH_LABEL = { short: "Short", medium: "Short and Medium", long: "Short, Medium and Long" };

function UsageCard({ account }: { account: Account }) {
  const { limit, used } = account;
  const remaining = Math.max(limit.generations - used, 0);
  const percent = limit.generations > 0 ? Math.min((used / limit.generations) * 100, 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generations</CardTitle>
        <CardDescription>
          {limit.period === "lifetime" ? "Guest allowance (does not reset)" : "This month"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="counter text-3xl font-medium">
          {used}
          <span className="text-muted"> / {limit.generations}</span>
        </p>
        <div
          role="progressbar"
          aria-label="Generations used"
          aria-valuemin={0}
          aria-valuemax={limit.generations}
          aria-valuenow={used}
          className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-muted">
          {remaining} left · lengths available: {LENGTH_LABEL[limit.max_length]}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function AppHomePage() {
  const user = await requireUser("/app");
  const account = await getAccount(user.id);

  if (!account) {
    return (
      <EmptyState
        tone="danger"
        icon={<TriangleAlert />}
        title="We couldn't load your workspace"
        description="The database didn't answer. Your content is safe — this usually clears up within a minute."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app">Try again</Link>
          </Button>
        }
      />
    );
  }

  const guest = isGuest(user);
  const name = account.profile.display_name;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {guest ? "Welcome, guest" : name ? `Welcome, ${name}` : "Welcome"}
        </h1>
        <p className="max-w-xl leading-relaxed text-muted">
          You&apos;re signed in and your workspace is ready. The generator, library and calendar are
          added in the next build phases.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <UsageCard account={account} />

        {guest ? (
          <Card variant="accent">
            <CardHeader>
              <CardTitle>Keep what you make</CardTitle>
              <CardDescription>
                Guest sessions live in this browser only. Create a free account to keep your
                content, get 5 generations every month and unlock publishing.
              </CardDescription>
            </CardHeader>
            <CardContent />
            <CardFooter>
              <Button asChild size="sm">
                <Link href="/app/upgrade">
                  <UserPlus aria-hidden="true" />
                  Create free account
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>{user.email}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted">
              Plan:{" "}
              <span className="font-medium text-foreground capitalize">{account.profile.plan}</span>
              . Profile settings and billing arrive with the app shell.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
