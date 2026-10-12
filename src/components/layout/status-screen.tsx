import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";

type StatusScreenProps = {
  /** Short mono eyebrow, e.g. "404" or "Error". */
  code: string;
  title: string;
  description: string;
  /** Optional reference shown to help match server logs (e.g. an error digest). */
  reference?: string;
  children?: React.ReactNode;
};

/** Full-page status layout shared by the 404 and error screens. */
export function StatusScreen({ code, title, description, reference, children }: StatusScreenProps) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid" />
      <header className="relative z-10 px-6 py-5">
        <Link href="/" className="inline-flex rounded-sm">
          <Wordmark />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-24">
        <div className="flex max-w-md flex-col items-center gap-5 text-center">
          <span className="rounded-sm border border-border bg-surface px-2 py-1 counter text-xs text-accent">
            {code}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="leading-relaxed text-muted">{description}</p>
          {children ? (
            <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div>
          ) : null}
          {reference ? <p className="counter text-xs text-subtle">ref: {reference}</p> : null}
        </div>
      </main>
    </div>
  );
}
