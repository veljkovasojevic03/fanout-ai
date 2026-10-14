"use client";

import { DemoCard } from "@/components/generator/demo-card";
import type { AppLocale } from "@/i18n/config";
import { CONTENT_TYPES } from "@/lib/presets";
import type { FixtureId } from "@/lib/sample";

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
          className={type === "blog" ? "xl:col-span-2" : undefined}
        />
      ))}
    </div>
  );
}
