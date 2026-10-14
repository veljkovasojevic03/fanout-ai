"use client";

import { m } from "motion/react";

import { DemoCard } from "@/components/generator/demo-card";
import type { AppLocale } from "@/i18n/config";
import { CONTENT_TYPES } from "@/lib/presets";
import type { FixtureId } from "@/lib/sample";

import { demoCardClass } from "./demo-layout";

/**
 * The five streaming cards of the landing demo, entering one after another.
 * Loaded on demand (the first Generate), so the streaming code is not part of
 * the landing page's first download.
 */
export default function DemoResults({
  fixture,
  language,
}: {
  fixture: FixtureId;
  language: AppLocale;
}) {
  return (
    <>
      {CONTENT_TYPES.map((type, index) => (
        <m.div
          key={type}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.07, ease: [0.2, 0.7, 0.2, 1] }}
          className={demoCardClass(type)}
        >
          <DemoCard type={type} fixture={fixture} language={language} className="h-full w-full" />
        </m.div>
      ))}
    </>
  );
}
