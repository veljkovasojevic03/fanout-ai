"use client";

import { useCallback } from "react";

import { StreamCard } from "@/components/generator/stream-card";
import type { StreamRequestFactory } from "@/components/generator/use-content-stream";
import type { AppLocale } from "@/i18n/config";
import { CONTENT_TYPES, type ContentType } from "@/lib/presets";
import type { FixtureId } from "@/lib/sample";

function DemoCard({
  type,
  fixture,
  language,
}: {
  type: ContentType;
  fixture: FixtureId;
  language: AppLocale;
}) {
  const request = useCallback<StreamRequestFactory>(
    ({ attempt }) => ({ url: "/api/demo/stream", body: { fixture, type, language, attempt } }),
    [fixture, type, language],
  );

  return (
    <StreamCard
      type={type}
      language={language}
      request={request}
      regenerationsLeft={null}
      className={type === "blog" ? "xl:col-span-2" : undefined}
    />
  );
}

/** Five cards streaming a hand-written fixture from the public demo endpoint. */
export function DemoCards({ fixture, language }: { fixture: FixtureId; language: AppLocale }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {CONTENT_TYPES.map((type) => (
        <DemoCard
          key={`${fixture}:${language}:${type}`}
          type={type}
          fixture={fixture}
          language={language}
        />
      ))}
    </div>
  );
}
