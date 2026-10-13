import { Inbox, Plus, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FanoutMark, Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsageMeter } from "@/components/ui/usage-meter";

import { DialogDemo, DropdownDemo, FormDemo, LoadingButtonDemo, ToastDemo } from "./demos";

// Internal reference page: not linked from the product and kept out of search engines.
export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { id: "brand", label: "Brand" },
  { id: "color", label: "Color" },
  { id: "type", label: "Typography" },
  { id: "button", label: "Button" },
  { id: "badge", label: "Badge" },
  { id: "card", label: "Card" },
  { id: "form", label: "Input & Select" },
  { id: "tabs", label: "Tabs" },
  { id: "dialog", label: "Dialog" },
  { id: "toast", label: "Toast" },
  { id: "skeleton", label: "Skeleton" },
  { id: "empty", label: "EmptyState" },
  { id: "usage", label: "UsageMeter" },
  { id: "menu", label: "DropdownMenu" },
] as const;

const COLORS = [
  { name: "background", value: "#0A0A0B", className: "bg-background" },
  { name: "surface", value: "#111113", className: "bg-surface" },
  { name: "elevated", value: "#17171A", className: "bg-elevated" },
  { name: "border", value: "white / 8%", className: "bg-border" },
  { name: "border-strong", value: "white / 16%", className: "bg-border-strong" },
  { name: "foreground", value: "#EDEDEF", className: "bg-foreground" },
  { name: "muted", value: "#8B8B94", className: "bg-muted" },
  { name: "subtle", value: "#5D5D66", className: "bg-subtle" },
  { name: "accent", value: "#B6FF3B", className: "bg-accent" },
  { name: "success", value: "#58D1A0", className: "bg-success" },
  { name: "warn", value: "#E6B45C", className: "bg-warn" },
  { name: "danger", value: "#F2757E", className: "bg-danger" },
] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: (typeof SECTIONS)[number]["id"];
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8">
      <div className="mb-5 flex flex-col gap-1.5">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center">
      <span className="w-28 shrink-0 counter text-xs text-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export default function DesignPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl gap-12 px-5 py-10 sm:px-8">
      <aside className="sticky top-10 hidden h-fit w-44 shrink-0 lg:block">
        <Link href="/" className="inline-flex rounded-sm">
          <Wordmark size="sm" />
        </Link>
        <nav aria-label="Design system sections" className="mt-8">
          <ul className="flex flex-col gap-0.5 border-l border-border">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-px block rounded-r-sm border-l border-transparent py-1.5 pl-4 text-[13px] text-muted transition-colors hover:border-accent hover:text-foreground"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-16">
        <header className="flex flex-col gap-4">
          <Badge variant="accent" className="w-fit">
            Internal
          </Badge>
          <h1 className="text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">Design system</h1>
          <p className="max-w-2xl leading-relaxed text-muted">
            Every token and component in the Fanout kit, in every state. Dark-only, one accent, 1px
            borders. If it is not on this page, it is not in the product.
          </p>
        </header>

        <Section
          id="brand"
          title="Brand"
          description="The mark is the product: one source point fanning out into five outputs."
        >
          <Card>
            <CardContent className="flex flex-col gap-8">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
                <Wordmark size="lg" />
                <Wordmark size="md" />
                <Wordmark size="sm" />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex size-14 items-center justify-center rounded-xl border border-border bg-background">
                  <FanoutMark className="size-8" />
                </span>
                <span className="flex size-14 items-center justify-center rounded-xl bg-accent">
                  <FanoutMark className="size-8 text-accent-foreground" />
                </span>
                <span className="flex size-14 items-center justify-center rounded-xl border border-border bg-elevated">
                  <FanoutMark className="size-8 text-foreground" />
                </span>
              </div>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="color"
          title="Color"
          description="Three stacked neutrals, two text tones, and a single acid-lime accent. Semantic tones are deliberately muted so the accent stays the loudest thing on screen."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {COLORS.map((color) => (
              <li key={color.name} className="overflow-hidden rounded-lg border border-border">
                <div className={`h-16 ${color.className}`} />
                <div className="flex flex-col gap-0.5 border-t border-border bg-surface px-3 py-2.5">
                  <span className="text-[13px] font-medium">{color.name}</span>
                  <span className="counter text-[11px] text-muted">{color.value}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="type"
          title="Typography"
          description="Geist for interface and headings with tight tracking; JetBrains Mono for counters, codes and labels."
        >
          <Card>
            <CardContent className="flex flex-col gap-6">
              <p className="text-5xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-6xl">
                One idea. <span className="text-accent">Five formats.</span>
              </p>
              <p className="text-3xl font-semibold tracking-tight">Heading — 30 / semibold</p>
              <p className="text-xl font-semibold tracking-tight">Section title — 20 / semibold</p>
              <p className="max-w-xl leading-relaxed">
                Body — 16 / regular. Jedna ideja, pet formata: šta god da pišeš, čćžšđ ČĆŽŠĐ moraju
                da izgledaju besprekorno.
              </p>
              <p className="max-w-xl text-sm leading-relaxed text-muted">
                Secondary — 14 / muted. Used for descriptions, hints and supporting copy.
              </p>
              <p className="counter text-sm text-muted">
                <span className="text-foreground">184</span> words ·{" "}
                <span className="text-foreground">1,204</span> chars ·{" "}
                <span className="text-accent">247/280</span>
              </p>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="button"
          title="Button"
          description="One primary action per view. Tab through to see the focus ring; the loading state blocks input and sets aria-busy."
        >
          <Card>
            <CardContent>
              <Row label="variant">
                <Button>Generate</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Delete</Button>
                <Button variant="link">Link</Button>
              </Row>
              <Row label="size">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" variant="secondary" aria-label="Add">
                  <Plus aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Regenerate">
                  <RotateCcw aria-hidden="true" />
                </Button>
              </Row>
              <Row label="with icon">
                <Button>
                  <Sparkles aria-hidden="true" />
                  Generate
                </Button>
                <Button variant="secondary">
                  <RotateCcw aria-hidden="true" />
                  Regenerate
                </Button>
              </Row>
              <Row label="disabled">
                <Button disabled>Generate</Button>
                <Button variant="secondary" disabled>
                  Secondary
                </Button>
                <Button variant="ghost" disabled>
                  Ghost
                </Button>
              </Row>
              <Row label="loading">
                <Button loading>Generating…</Button>
                <Button variant="secondary" loading>
                  Saving…
                </Button>
                <LoadingButtonDemo />
              </Row>
              <Row label="as link">
                <Button asChild variant="outline">
                  <Link href="/">Rendered as a link</Link>
                </Button>
              </Row>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="badge"
          title="Badge"
          description="Mono labels for plans, modes and statuses. The optional dot carries status without relying on color alone — the text always says it too."
        >
          <Card>
            <CardContent>
              <Row label="variant">
                <Badge>Neutral</Badge>
                <Badge variant="accent">Accent</Badge>
                <Badge variant="solid">Solid</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warn">Warn</Badge>
                <Badge variant="danger">Danger</Badge>
              </Row>
              <Row label="plan">
                <Badge>Guest</Badge>
                <Badge variant="accent">Free</Badge>
                <Badge variant="solid">Pro</Badge>
              </Row>
              <Row label="status">
                <Badge dot>Scheduled</Badge>
                <Badge variant="warn" dot>
                  Processing
                </Badge>
                <Badge variant="success" dot>
                  Published
                </Badge>
                <Badge variant="danger" dot>
                  Failed
                </Badge>
              </Row>
              <Row label="mode">
                <Badge variant="accent">
                  <Sparkles aria-hidden="true" />
                  Live
                </Badge>
                <Badge>Sample output</Badge>
                <Badge>Simulated</Badge>
              </Row>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="card"
          title="Card"
          description="Surfaces are separated by 1px borders and a step in lightness, never by drop shadows. Glow is reserved for the single highlighted element."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Default</CardTitle>
                <CardDescription>Surface background, hairline border.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                The workhorse container for lists, forms and stats.
              </CardContent>
            </Card>
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>Elevated</CardTitle>
                <CardDescription>One step lighter, for nested or raised content.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                Used for popovers, dialogs and cards inside cards.
              </CardContent>
            </Card>
            <Card interactive tabIndex={0}>
              <CardHeader>
                <CardTitle>Interactive</CardTitle>
                <CardDescription>Hover or focus me.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                Border and background respond; no movement, no shadow.
              </CardContent>
            </Card>
            <Card variant="accent">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>Accent</CardTitle>
                  <Badge variant="solid">Pro</Badge>
                </div>
                <CardDescription>The one highlighted card in a group.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                Lime ring and soft glow. Use at most once per view.
              </CardContent>
              <CardFooter>
                <Button size="sm">Upgrade</Button>
                <Button size="sm" variant="ghost">
                  Compare plans
                </Button>
              </CardFooter>
            </Card>
            <Card variant="ghost" className="sm:col-span-2">
              <CardHeader>
                <CardTitle>Ghost</CardTitle>
                <CardDescription>
                  Dashed outline for drop zones and “add new” slots.
                </CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </div>
        </Section>

        <Section
          id="form"
          title="Input & Select"
          description="Field wires the label, hint and error to the control automatically (id, aria-describedby, aria-invalid). States shown: default, live validation, error, disabled, placeholder."
        >
          <Card>
            <CardContent>
              <FormDemo />
            </CardContent>
          </Card>
        </Section>

        <Section
          id="tabs"
          title="Tabs"
          description="Arrow keys move between tabs; Home and End jump to the ends. Includes a disabled tab."
        >
          <Card>
            <CardContent>
              <Tabs defaultValue="edit">
                <TabsList aria-label="Editor view">
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="preview">Preview</TabsTrigger>
                  <TabsTrigger value="history" disabled>
                    History
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="text-sm leading-relaxed text-muted">
                  <span className="font-mono text-foreground"># Why small teams ship weekly</span>
                  <br />
                  Markdown source goes here.
                </TabsContent>
                <TabsContent value="preview" className="text-sm leading-relaxed text-muted">
                  <span className="text-lg font-semibold text-foreground">
                    Why small teams ship weekly
                  </span>
                  <br />
                  Rendered preview goes here.
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="dialog"
          title="Dialog"
          description="Focus is trapped while open and returns to the trigger on close. Esc and the overlay dismiss it."
        >
          <Card>
            <CardContent>
              <DialogDemo />
            </CardContent>
          </Card>
        </Section>

        <Section
          id="toast"
          title="Toast"
          description="Short confirmations and recoverable errors, announced politely to screen readers. Never the only place an error is shown."
        >
          <Card>
            <CardContent>
              <ToastDemo />
            </CardContent>
          </Card>
        </Section>

        <Section
          id="skeleton"
          title="Skeleton"
          description="Placeholders match the shape of what is loading. The shimmer stops under prefers-reduced-motion."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Card aria-busy="true" aria-label="Loading content card">
              <CardHeader>
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/6" />
              </CardContent>
            </Card>
            <Card aria-busy="true" aria-label="Loading list">
              <CardContent className="flex flex-col gap-4">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-center gap-3">
                    <Skeleton className="size-9 rounded-md" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-5 w-14" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="empty"
          title="EmptyState"
          description="Every list needs one. Say what belongs here and offer the next step. The danger tone covers recoverable load errors."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <EmptyState
              icon={<Inbox />}
              title="Your library is empty"
              description="Pieces you save from the generator show up here."
              action={
                <Button size="sm">
                  <Sparkles aria-hidden="true" />
                  Generate something
                </Button>
              }
            />
            <EmptyState
              tone="danger"
              icon={<TriangleAlert />}
              title="Could not load your library"
              description="The connection dropped. Your content is safe."
              action={
                <Button size="sm" variant="secondary">
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
              }
            />
          </div>
        </Section>

        <Section
          id="usage"
          title="UsageMeter"
          description="Quota at a glance. The bar turns amber from 80% and red at the limit, but the mono counter always carries the meaning."
        >
          <Card>
            <CardContent>
              <Row label="ok">
                <UsageMeter className="w-56" used={1} limit={5} label="1 of 5 generations used" />
              </Row>
              <Row label="low (80%+)">
                <UsageMeter className="w-56" used={4} limit={5} label="4 of 5 generations used" />
              </Row>
              <Row label="exhausted">
                <UsageMeter className="w-56" used={5} limit={5} label="5 of 5 generations used" />
              </Row>
              <Row label="size sm">
                <UsageMeter
                  size="sm"
                  className="w-32"
                  used={42}
                  limit={100}
                  label="42 of 100 generations used"
                />
              </Row>
              <Row label="bar only">
                <UsageMeter
                  hideCount
                  className="w-56"
                  used={2}
                  limit={3}
                  label="2 of 3 generations used"
                />
              </Row>
            </CardContent>
          </Card>
        </Section>

        <Section
          id="menu"
          title="DropdownMenu"
          description="Arrow keys move, Enter selects, Esc closes and returns focus to the trigger. Type a letter to jump to an item."
        >
          <Card>
            <CardContent>
              <DropdownDemo />
            </CardContent>
          </Card>
        </Section>
      </main>
    </div>
  );
}
