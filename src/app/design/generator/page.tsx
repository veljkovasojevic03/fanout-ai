import type { Metadata } from "next";
import Link from "next/link";

import { Generator } from "@/components/generator/generator";
import { Badge } from "@/components/ui/badge";
import { isAppLocale } from "@/i18n/config";
import { FIXTURE_IDS, type FixtureId } from "@/lib/sample";

import { DemoCards } from "./demo-cards";

// Internal preview of the streaming cards, fed by the public Sample-mode demo
// endpoint — no session and no database needed.
//   /design/generator?fixture=thought_leadership&lang=sr
export const metadata: Metadata = {
  title: "Generator preview",
  robots: { index: false, follow: false },
};

export default async function GeneratorPreviewPage({
  searchParams,
}: PageProps<"/design/generator">) {
  const params = await searchParams;
  const fixture: FixtureId = FIXTURE_IDS.includes(params.fixture as FixtureId)
    ? (params.fixture as FixtureId)
    : "product_launch";
  const language = isAppLocale(params.lang) ? params.lang : "en";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <Badge variant="accent" className="w-fit">
          Internal
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Generator preview</h1>
        <p className="max-w-2xl leading-relaxed text-muted">
          Five StreamCards streaming a hand-written fixture in parallel. Try Stop, Copy and
          Regenerate; switch fixture or language below.
        </p>
        <nav aria-label="Fixture and language" className="flex flex-wrap gap-2 text-sm">
          {FIXTURE_IDS.flatMap((id) =>
            (["en", "sr"] as const).map((lang) => (
              <Link
                key={`${id}-${lang}`}
                href={{ pathname: "/design/generator", query: { fixture: id, lang } }}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                  id === fixture && lang === language
                    ? "border-accent-ring bg-accent-soft text-accent"
                    : "border-border text-muted hover:text-foreground"
                }`}
              >
                {id} · {lang}
              </Link>
            )),
          )}
        </nav>
      </header>
      <DemoCards fixture={fixture} language={language} />

      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold tracking-tight">Form</h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted">
            The generator form on a Free plan (Long is locked). There is no session here, so
            submitting shows the signed-out error. Add <code>?quota=0</code> for the exhausted
            state.
          </p>
        </div>
        <Generator
          key={params.quota === "0" ? "exhausted" : "open"}
          initial={{
            topic: "Why small teams should ship every week",
            tone: "casual",
            length: "medium",
            contentLanguage: language,
            keywords: ["shipping", "small teams"],
            types: ["blog", "linkedin", "x_thread"],
            sourceKind: "none",
            sourceUrl: "",
            sourceText: "",
          }}
          plan="free"
          guest={false}
          maxLength="medium"
          remaining={params.quota === "0" ? 0 : 3}
          resetDate="November 1"
          presetName="Thought-leadership post"
        />
      </section>
    </div>
  );
}
