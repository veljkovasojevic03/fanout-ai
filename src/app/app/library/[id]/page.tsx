import { FileQuestion, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ContentEditor } from "@/components/library/content-editor";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getAppContext } from "@/lib/auth/session";
import { getContent, getRefinementsUsed, getUserTags } from "@/lib/library/queries";
import { REFINE_LIMITS } from "@/lib/refine/schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("editor");
  return { title: t("metaTitle") };
}

export default async function ContentPage({ params }: PageProps<"/app/library/[id]">) {
  const { id } = await params;
  const context = await getAppContext(`/app/library/${id}`);
  if (!context) return null;

  const [t, found, knownTags] = await Promise.all([
    getTranslations("editor"),
    getContent(id),
    getUserTags(),
  ]);

  if (found.status !== "ok") {
    const missing = found.status === "not_found";
    return (
      <EmptyState
        tone={missing ? "neutral" : "danger"}
        icon={missing ? <FileQuestion /> : <TriangleAlert />}
        title={t(missing ? "notFound.title" : "loadError.title")}
        description={t(missing ? "notFound.description" : "loadError.description")}
        action={
          <Button asChild variant="secondary">
            <Link href="/app/library">{t(missing ? "notFound.action" : "loadError.action")}</Link>
          </Button>
        }
      />
    );
  }

  const { content } = found;
  const used = await getRefinementsUsed(content.generation_id);

  return (
    <>
      <h1 className="sr-only">{content.title}</h1>
      <ContentEditor
        // Another piece is another editor: never carry drafts or undo steps across.
        key={content.id}
        content={{
          id: content.id,
          type: content.type,
          title: content.title,
          body: content.body_md,
          language: content.language,
          tags: content.tags,
        }}
        knownTags={knownTags}
        refinementsLeft={used === null ? null : Math.max(REFINE_LIMITS.maxPerGeneration - used, 0)}
      />
    </>
  );
}
