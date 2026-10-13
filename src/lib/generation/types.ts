import type { AppLocale } from "@/i18n/config";
import type { ContentType, Length, Tone } from "@/lib/presets";

/** What a content source needs to know to write one piece. */
export type GenerationBrief = {
  topic: string;
  tone: Tone;
  length: Length;
  language: AppLocale;
  keywords: readonly string[];
  /** Untrusted text supplied by the user (pasted, or extracted from a URL). */
  sourceText: string | null;
};

export type GenerationMode = "live" | "sample";

/**
 * The one streaming interface both modes implement. The API route and the UI
 * only ever see this, which is why they cannot tell Sample from Live apart
 * from the `mode` flag.
 */
export type StreamChunk =
  { type: "delta"; text: string } | { type: "usage"; inputTokens: number; outputTokens: number };

export type ContentStream = AsyncIterable<StreamChunk>;

export type ContentSource = (request: {
  brief: GenerationBrief;
  type: ContentType;
  /** Stable per (generation, type, attempt); the sample simulator seeds from it. */
  seed: string;
  signal: AbortSignal;
}) => ContentStream;

/** Failures a content source may raise; `code` is what the client translates. */
export const STREAM_ERROR_CODES = [
  "llm_rate_limited",
  "llm_overloaded",
  "llm_unavailable",
  "llm_refused",
  "llm_misconfigured",
  "stream_failed",
] as const;
export type StreamErrorCode = (typeof STREAM_ERROR_CODES)[number];

export class StreamError extends Error {
  constructor(
    readonly code: StreamErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "StreamError";
  }
}
