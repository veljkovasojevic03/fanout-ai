import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard/dashboard-view";
import { AppShell } from "@/components/shell/app-shell";
import { WakingUp } from "@/components/shell/waking-up";
import type { Account } from "@/lib/auth/session";
import type { RecentContent } from "@/lib/dashboard";

// Internal preview of the app shell and dashboard with SAMPLE data — no session,
// no database. Lets the layout be reviewed at 375 / 768 / 1280 in every state:
//   /design/shell                 free user with content
//   /design/shell?state=guest     guest, nothing saved yet
//   /design/shell?state=pro       pro user near the limit
//   /design/shell?state=error     account failed to load
//   /design/shell?state=waking    backend unreachable
export const metadata: Metadata = {
  title: "Shell preview",
  robots: { index: false, follow: false },
};

const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

function sampleAccount(plan: Account["profile"]["plan"]): Account {
  const limits = {
    guest: { generations: 3, period: "lifetime", max_length: "medium" },
    free: { generations: 5, period: "month", max_length: "medium" },
    pro: { generations: 100, period: "month", max_length: "long" },
  } as const;
  const usage = {
    guest: { generations: 1, words: 1240, totalGenerations: 1, totalWords: 1240 },
    free: { generations: 2, words: 3180, totalGenerations: 14, totalWords: 21650 },
    pro: { generations: 87, words: 96400, totalGenerations: 412, totalWords: 508300 },
  } as const;

  return {
    profile: {
      id: SAMPLE_ID,
      display_name: plan === "guest" ? null : "Ada Lovelace",
      ui_language: "en",
      default_content_language: "en",
      default_tone: "professional",
      plan,
    },
    limit: { plan, ...limits[plan] },
    usage: usage[plan],
  };
}

function sampleRecent(): RecentContent {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  return {
    total: 23,
    items: [
      {
        id: id(1),
        type: "blog",
        title: "Why small teams should ship weekly",
        word_count: 812,
        updated_at: hoursAgo(2),
      },
      {
        id: id(2),
        type: "linkedin",
        title: "The meeting we cancelled for good",
        word_count: 184,
        updated_at: hoursAgo(26),
      },
      {
        id: id(3),
        type: "email",
        title: "This week: shipping notes and one hard lesson",
        word_count: 296,
        updated_at: hoursAgo(50),
      },
      {
        id: id(4),
        type: "x_thread",
        title: "7 things I'd tell myself before my first launch",
        word_count: 231,
        updated_at: hoursAgo(120),
      },
      {
        id: id(5),
        type: "instagram",
        title: "Behind the scenes of launch day",
        word_count: 74,
        updated_at: hoursAgo(300),
      },
    ],
  };
}

export default async function ShellPreviewPage({ searchParams }: PageProps<"/design/shell">) {
  const { state } = await searchParams;

  if (state === "waking") return <WakingUp />;

  if (state === "error") {
    return (
      <AppShell account={null} email="ada@example.com" guest={false}>
        {null}
      </AppShell>
    );
  }

  const plan = state === "guest" ? "guest" : state === "pro" ? "pro" : "free";
  const guest = plan === "guest";
  const account = sampleAccount(plan);

  return (
    <AppShell account={account} email={guest ? null : "ada@example.com"} guest={guest}>
      <DashboardView
        account={account}
        guest={guest}
        recent={guest ? { items: [], total: 0 } : sampleRecent()}
      />
    </AppShell>
  );
}
