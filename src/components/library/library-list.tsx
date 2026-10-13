import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { PublishButton } from "@/components/publish/publish-dialog";
import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ContentListItem } from "@/lib/library/schema";
import { libraryQuery, pageCount, type LibraryParams } from "@/lib/library/search";

const VISIBLE_TAGS = 3;

type LibraryListProps = {
  items: readonly ContentListItem[];
  total: number;
  params: LibraryParams;
  /** Guests get the "Upgrade to publish" state from the row's publish button. */
  guest?: boolean;
};

/** One page of saved pieces, with the result count and page links. */
export function LibraryList({ items, total, params, guest = false }: LibraryListProps) {
  const t = useTranslations();
  const format = useFormatter();
  const now = useNow();
  const pages = pageCount(total);

  const pageHref = (page: number) => ({
    pathname: "/app/library" as const,
    query: libraryQuery({ ...params, page }),
  });

  return (
    <section aria-labelledby="library-results" className="flex flex-col gap-4">
      <h2 id="library-results" className="counter text-xs text-muted" aria-live="polite">
        {t("library.results", { count: total })}
      </h2>

      <Card>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="relative flex items-center">
              <Link
                href={`/app/library/${item.id}` as Route}
                aria-label={t("library.item.open", { title: item.title })}
                className="flex min-w-0 flex-1 items-center gap-3.5 rounded-[inherit] py-4 pr-2 pl-5 transition-colors hover:bg-white/[0.03] focus-visible:-outline-offset-2"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-elevated text-muted">
                  <ContentTypeIcon type={item.type} className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">{item.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                    <span>
                      {t(`common.formats.${item.type}`)} · {t(`common.languages.${item.language}`)}{" "}
                      · {t("library.item.words", { count: item.word_count })}
                    </span>
                    {item.tags.slice(0, VISIBLE_TAGS).map((tag) => (
                      <Badge key={tag} className="max-w-32">
                        <span className="truncate">{tag}</span>
                      </Badge>
                    ))}
                    {item.tags.length > VISIBLE_TAGS ? (
                      <span className="text-xs">
                        {t("library.item.moreTags", { count: item.tags.length - VISIBLE_TAGS })}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="hidden shrink-0 text-[13px] text-muted sm:block">
                  {t("library.item.updated", {
                    time: format.relativeTime(new Date(item.updated_at), now),
                  })}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle" />
              </Link>
              {/* Next to the link, not inside it: a button cannot live in an anchor. */}
              <PublishButton
                contentId={item.id}
                title={item.title}
                guest={guest}
                iconOnly
                variant="ghost"
                size="icon-sm"
                className="mr-3 shrink-0"
              />
            </li>
          ))}
        </ul>
      </Card>

      {pages > 1 ? (
        <nav
          aria-label={t("library.pagination.label")}
          className="flex items-center justify-between gap-3"
        >
          {params.page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(params.page - 1)} rel="prev">
                <ChevronLeft aria-hidden="true" />
                {t("library.pagination.previous")}
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              <ChevronLeft aria-hidden="true" />
              {t("library.pagination.previous")}
            </Button>
          )}
          <p className="counter text-xs text-muted" aria-current="page">
            {t("library.pagination.status", { page: params.page, pages })}
          </p>
          {params.page < pages ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={pageHref(params.page + 1)} rel="next">
                {t("library.pagination.next")}
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled>
              {t("library.pagination.next")}
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </nav>
      ) : null}
    </section>
  );
}

/** Placeholder with the same shape as the list, for loading states. */
export function LibraryListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-3 w-20" />
      <Card>
        <ul className="divide-y divide-border">
          {Array.from({ length: rows }, (_, row) => (
            <li key={row} className="flex items-center gap-3.5 px-5 py-4">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="hidden h-3 w-24 sm:block" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
