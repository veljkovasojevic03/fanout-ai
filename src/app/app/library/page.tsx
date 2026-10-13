import { Library, SearchX, Sparkles, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LibraryFilters } from "@/components/library/library-filters";
import { LibraryList } from "@/components/library/library-list";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getAppContext } from "@/lib/auth/session";
import { getUserTags, listContents } from "@/lib/library/queries";
import { hasActiveFilters, libraryHref, pageCount, parseLibraryParams } from "@/lib/library/search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("metaTitle") };
}

export default async function LibraryPage({ searchParams }: PageProps<"/app/library">) {
  const context = await getAppContext("/app/library");
  if (!context) return null;

  const params = parseLibraryParams(await searchParams);
  const [t, page, tags] = await Promise.all([
    getTranslations(),
    listContents(params),
    getUserTags(),
  ]);

  // A page past the end (e.g. after deleting the last piece on it): go to the last one.
  if (page && page.items.length === 0 && page.total > 0 && params.page > 1) {
    redirect(libraryHref({ ...params, page: pageCount(page.total) }));
  }

  const filtered = hasActiveFilters(params);
  const generate = (
    <Button asChild>
      <Link href="/app/generate">
        <Sparkles aria-hidden="true" />
        {t("library.empty.action")}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("library.title")}
        description={t("library.description")}
        aside={page && (page.total > 0 || filtered) ? generate : undefined}
      />

      {page === null ? (
        <EmptyState
          tone="danger"
          icon={<TriangleAlert />}
          title={t("library.loadError.title")}
          description={t("library.loadError.description")}
        />
      ) : page.total === 0 && !filtered ? (
        <EmptyState
          icon={<Library />}
          title={t("library.empty.title")}
          description={t("library.empty.description")}
          action={generate}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <LibraryFilters params={params} tags={tags} />
          {page.total === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title={t("library.noResults.title")}
              description={t("library.noResults.description")}
              action={
                <Button asChild variant="secondary">
                  <Link href={libraryHref({ ...params, q: "", type: null, tag: null, page: 1 })}>
                    {t("library.noResults.action")}
                  </Link>
                </Button>
              }
            />
          ) : (
            <LibraryList items={page.items} total={page.total} params={params} />
          )}
        </div>
      )}
    </>
  );
}
