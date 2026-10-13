import type { Metadata } from "next";
import { getNow, getTimeZone } from "next-intl/server";

import { CalendarView, type CalendarJob } from "@/components/publish/calendar-view";
import { DestinationsSection } from "@/components/publish/destinations-section";
import { JobStatusBadge, SimulatedBadge } from "@/components/publish/job-status";
import { PublishButton } from "@/components/publish/publish-dialog";
import { Badge } from "@/components/ui/badge";
import type { DestinationView } from "@/lib/publish/destinations";
import { JOB_STATUSES, type JobView } from "@/lib/publish/schema";
import { dayKey, monthGrid, monthOf } from "@/lib/publish/time";

// Internal preview of the Phase 6 components with sample data — no session, no
// database and no n8n needed. Buttons that change something call the real
// server actions, which answer with the signed-out error here.
export const metadata: Metadata = {
  title: "Publishing preview",
  robots: { index: false, follow: false },
};

const DISCORD: DestinationView[] = [
  {
    id: "00000000-0000-4000-8000-0000000000d1",
    kind: "discord",
    label: "Team announcements",
    hint: "discord.com/…/5678/••••1234",
  },
  {
    id: "00000000-0000-4000-8000-0000000000d2",
    kind: "discord",
    label: "Launch channel",
    hint: "discord.com/…/9012/••••abCD",
  },
];

const EMAIL = {
  id: "00000000-0000-4000-8000-0000000000e1",
  kind: "email",
  label: "Email",
} as const;

function sampleJobs(now: Date): JobView[] {
  const at = (days: number, hours = 0) =>
    new Date(now.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
  const job = (index: number, overrides: Partial<JobView>): JobView => ({
    id: `00000000-0000-4000-8000-00000000010${index}`,
    status: "scheduled",
    scheduledAt: at(1),
    publishedAt: null,
    attempts: 0,
    lastError: null,
    simulated: false,
    content: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Why small teams should ship every week",
      type: "blog",
    },
    destination: EMAIL,
    attemptsLog: [],
    ...overrides,
  });
  const attempt = (id: string, startedAt: string, ok: boolean | null, detail: string | null) => ({
    id,
    startedAt,
    finishedAt: ok === null ? null : startedAt,
    ok,
    detail,
  });

  return [
    job(1, {
      status: "published",
      scheduledAt: at(-3),
      publishedAt: at(-3),
      attempts: 1,
      simulated: true,
      attemptsLog: [attempt("a1", at(-3), true, null)],
    }),
    job(2, {
      status: "failed",
      scheduledAt: at(-1),
      attempts: 2,
      lastError: "delivery_failed:429",
      destination: DISCORD[0]!,
      content: {
        id: "00000000-0000-4000-8000-000000000002",
        title: "Launching a habit tracker that takes ten seconds a day",
        type: "x_thread",
      },
      attemptsLog: [
        attempt("a2", at(-1), false, "n8n_unreachable"),
        attempt("a3", at(-1, 1), false, "delivery_failed:429"),
      ],
    }),
    job(3, {
      status: "processing",
      scheduledAt: at(0),
      attempts: 1,
      content: {
        id: "00000000-0000-4000-8000-000000000003",
        title: "Besplatna online radionica: odredi cenu svog rada",
        type: "email",
      },
      attemptsLog: [attempt("a4", at(0), null, null)],
    }),
    job(4, { scheduledAt: at(1, 2) }),
    job(5, {
      scheduledAt: at(1, 5),
      destination: DISCORD[1]!,
      content: {
        id: "00000000-0000-4000-8000-000000000004",
        title: "Pricing workshop — LinkedIn",
        type: "linkedin",
      },
    }),
    job(6, { scheduledAt: at(1, 7), content: { ...job(0, {}).content, type: "instagram" } }),
    job(7, { scheduledAt: at(1, 9), content: { ...job(0, {}).content, type: "email" } }),
    job(8, { status: "cancelled", scheduledAt: at(4) }),
    job(9, {
      status: "failed",
      scheduledAt: at(-2),
      attempts: 5,
      lastError: "timeout",
      attemptsLog: Array.from({ length: 5 }, (_, index) =>
        attempt(`t${index}`, at(-2, index), false, "timeout"),
      ),
    }),
  ];
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function PublishPreviewPage() {
  const [now, timeZone] = await Promise.all([getNow(), getTimeZone()]);
  const month = monthOf(now, timeZone);
  const days = monthGrid(month, 1);
  const jobs = sampleJobs(now);
  const placed: CalendarJob[] = jobs.map((job) => ({
    ...job,
    day: dayKey(new Date(job.scheduledAt), timeZone),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <Badge variant="accent" className="w-fit">
          Internal
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Publishing preview</h1>
        <p className="max-w-2xl leading-relaxed text-muted">
          The calendar, the job dialog, the publish dialog and Settings → Publish destinations, with
          sample data placed around today ({timeZone}).
        </p>
      </header>

      <Section
        title="Statuses"
        description="Every job status, and the badge on anything that went through the simulated dispatcher."
      >
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-4">
          {JOB_STATUSES.map((status) => (
            <JobStatusBadge key={status} status={status} />
          ))}
          <SimulatedBadge />
        </div>
      </Section>

      <Section
        title="Publish dialog"
        description="As a signed-in user (loads the destinations, which fails here: no session), as a guest, and as the icon button used in library rows."
      >
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <PublishButton
            contentId="00000000-0000-4000-8000-000000000001"
            title="Why small teams should ship every week"
            guest={false}
            variant="primary"
          />
          <PublishButton
            contentId="00000000-0000-4000-8000-000000000001"
            title="Why small teams should ship every week"
            guest
          />
          <PublishButton
            contentId="00000000-0000-4000-8000-000000000001"
            title="Why small teams should ship every week"
            guest={false}
            iconOnly
            variant="ghost"
            size="icon-sm"
          />
        </div>
      </Section>

      <Section
        title="Calendar — simulated deployment"
        description="One job in every status. Click a chip or a row for the job dialog: reschedule and cancel on scheduled jobs, the reason and Retry on failed ones, the attempt log on all."
      >
        <CalendarView
          month={month}
          days={days}
          today={dayKey(now, timeZone)}
          jobs={placed}
          failed={jobs.filter((job) => job.status === "failed")}
          destinations={DISCORD}
          email="you@example.com"
          emailVerified
          mode="simulated"
        />
      </Section>

      <Section
        title="Calendar — empty"
        description="Nothing scheduled, real delivery connected (no simulated note)."
      >
        <CalendarView
          month={month}
          days={days}
          today={dayKey(now, timeZone)}
          jobs={[]}
          failed={[]}
          destinations={[]}
          email="you@example.com"
          emailVerified
          mode="n8n"
        />
      </Section>

      <Section title="Destinations" description="Settings → Publish destinations in each state.">
        <div className="flex flex-col gap-6">
          <DestinationsSection
            id="destinations-connected"
            guest={false}
            email="you@example.com"
            emailVerified
            destinations={DISCORD}
            mode="n8n"
          />
          <DestinationsSection
            id="destinations-simulated"
            guest={false}
            email="you@example.com"
            emailVerified={false}
            destinations={[]}
            mode="simulated"
          />
          <DestinationsSection
            id="destinations-error"
            guest={false}
            email="you@example.com"
            emailVerified
            destinations={null}
            mode="n8n"
          />
          <DestinationsSection
            id="destinations-guest"
            guest
            email={null}
            emailVerified={false}
            destinations={[]}
            mode="simulated"
          />
        </div>
      </Section>
    </div>
  );
}
