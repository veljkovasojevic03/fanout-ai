import type { Metadata } from "next";
import Link from "next/link";

import { ContentEditor, SaveIndicator } from "@/components/library/content-editor";
import { ContentPreview } from "@/components/library/content-preview";
import { LibraryFilters } from "@/components/library/library-filters";
import { LibraryList, LibraryListSkeleton } from "@/components/library/library-list";
import { Badge } from "@/components/ui/badge";
import { isAppLocale } from "@/i18n/config";
import type { ContentListItem } from "@/lib/library/schema";
import { DEFAULT_LIBRARY_PARAMS } from "@/lib/library/search";
import { CONTENT_TYPES, type ContentType } from "@/lib/presets";
import { fixtureText } from "@/lib/sample";

// Internal preview of the Phase 4 components with sample data — no session and
// no database needed.
//   /design/library?type=x_thread&lang=sr
export const metadata: Metadata = {
  title: "Library preview",
  robots: { index: false, follow: false },
};

const TAGS = ["launch", "newsletter", "pricing", "q3 plan"];

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const ITEMS: ContentListItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    type: "blog",
    title: "Why small teams should ship every week",
    language: "en",
    tags: ["launch", "q3 plan"],
    word_count: 412,
    updated_at: hoursAgo(2),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    type: "email",
    title: "Besplatna online radionica: odredi cenu svog rada",
    language: "sr",
    tags: ["newsletter", "pricing", "launch", "q3 plan", "events"],
    word_count: 231,
    updated_at: hoursAgo(26),
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    type: "x_thread",
    title: "Launching a habit tracker that takes ten seconds a day",
    language: "en",
    tags: [],
    word_count: 188,
    updated_at: hoursAgo(24 * 9),
  },
];

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

export default async function LibraryPreviewPage({ searchParams }: PageProps<"/design/library">) {
  const params = await searchParams;
  const type: ContentType = (CONTENT_TYPES as readonly string[]).includes(String(params.type))
    ? (params.type as ContentType)
    : "blog";
  const language = isAppLocale(params.lang) ? params.lang : "en";
  const body = fixtureText("thought_leadership", language, type);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <Badge variant="accent" className="w-fit">
          Internal
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Library preview</h1>
        <p className="max-w-2xl leading-relaxed text-muted">
          The library list, the editor and the per-format previews, fed with a sample fixture.
          Switch format or language below.
        </p>
        <nav aria-label="Format and language" className="flex flex-wrap gap-2 text-sm">
          {CONTENT_TYPES.flatMap((id) =>
            (["en", "sr"] as const).map((lang) => (
              <Link
                key={`${id}-${lang}`}
                href={{ pathname: "/design/library", query: { type: id, lang } }}
                className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                  id === type && lang === language
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

      <Section
        title="Library list"
        description="Filters, one page of results with pagination, and the loading skeleton. The filters write to the URL of the real library page."
      >
        <LibraryFilters params={{ ...DEFAULT_LIBRARY_PARAMS, tag: "launch" }} tags={TAGS} />
        <LibraryList items={ITEMS} total={27} params={{ ...DEFAULT_LIBRARY_PARAMS, page: 2 }} />
        <LibraryListSkeleton rows={3} />
      </Section>

      <Section
        title="Save indicator"
        description="The four autosave states shown in the editor's toolbar."
      >
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-surface p-4">
          <SaveIndicator status="saved" />
          <SaveIndicator status="dirty" />
          <SaveIndicator status="saving" />
          <SaveIndicator status="error" />
        </div>
      </Section>

      <Section
        title="Editor"
        description="The full editor. There is no session here, so autosave, refine, export, duplicate and delete all answer with the signed-out error — which is what the failed-save state looks like."
      >
        <ContentEditor
          key={`${type}-${language}`}
          content={{
            id: "00000000-0000-4000-8000-000000000001",
            type,
            title: "Why small teams should ship every week",
            body,
            language,
            tags: ["launch", "q3 plan"],
          }}
          knownTags={TAGS}
          refinementsLeft={7}
        />
      </Section>

      <Section
        title="Preview only"
        description="ContentPreview on its own: Markdown for blog and email, plain text for LinkedIn and Instagram, post cards for X."
      >
        <div className="rounded-md border border-border bg-surface p-5">
          <ContentPreview type={type} body={body} language={language} />
        </div>
      </Section>
    </div>
  );
}
