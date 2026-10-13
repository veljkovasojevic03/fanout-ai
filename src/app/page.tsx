import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FORMATS = ["Blog post", "LinkedIn", "Instagram", "Email", "X thread"] as const;

/*
 * Foundation placeholder. The real landing page with the interactive
 * Sample-mode demo replaces this in Phase 7.
 */
export default function HomePage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-10%] left-1/2 h-[420px] w-[640px] max-w-full -translate-x-1/2 glow-accent"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <Wordmark />
        <Badge variant="warn" dot>
          In development
        </Badge>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24">
        <div className="flex max-w-2xl flex-col items-center gap-7 text-center">
          <h1 className="text-5xl leading-[1.02] font-semibold tracking-[-0.04em] sm:text-7xl">
            One idea.
            <br />
            <span className="text-accent">Five formats.</span>
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-muted">
            Give Fanout one idea and get five ready-to-publish pieces, streamed side by side.
          </p>
          <ul className="flex flex-wrap justify-center gap-2" aria-label="Output formats">
            {FORMATS.map((format) => (
              <li key={format}>
                <Badge>{format}</Badge>
              </li>
            ))}
          </ul>
          <p className="max-w-md text-sm leading-relaxed text-subtle">
            Accounts and guest sessions work today. The generator, library and publishing are being
            built phase by phase.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Button asChild size="lg">
              <Link href="/guest">
                Try as guest
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/signup">Sign up</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
