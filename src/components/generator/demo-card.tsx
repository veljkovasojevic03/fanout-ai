"use client";

import { useCallback } from "react";

import type { AppLocale } from "@/i18n/config";
import type { ContentType } from "@/lib/presets";
import type { FixtureId } from "@/lib/sample";

import { StreamCard } from "./stream-card";
import type { StreamRequestFactory } from "./use-content-stream";

type DemoCardProps = {
  type: ContentType;
  fixture: FixtureId;
  language: AppLocale;
  className?: string;
};

/**
 * A StreamCard fed by the public demo endpoint (`POST /api/demo/stream`): a
 * hand-written fixture, streamed like a real generation. No session, no
 * database row, no model call — so there is no Save button either.
 */
export function DemoCard({ type, fixture, language, className }: DemoCardProps) {
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
      className={className}
    />
  );
}
