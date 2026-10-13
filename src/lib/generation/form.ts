import type { AppLocale } from "@/i18n/config";
import type { ContentType, Length, Tone } from "@/lib/presets";

import { GENERATION_LIMITS, type GenerateRequestInput } from "./schema";

/*
 * The generator form's state and its client-side checks. These exist for fast,
 * field-level feedback only; the server validates the same request again with
 * zod (schema.ts) and is the one that counts.
 */

export type SourceKind = "none" | "url" | "text";

export type GeneratorFormValues = {
  topic: string;
  tone: Tone;
  length: Length;
  contentLanguage: AppLocale;
  keywords: string[];
  types: ContentType[];
  sourceKind: SourceKind;
  sourceUrl: string;
  sourceText: string;
};

export const FORM_ERROR_CODES = [
  "topic_required",
  "topic_too_long",
  "formats_required",
  "url_required",
  "url_invalid",
  "text_required",
  "text_too_long",
] as const;
export type FormErrorCode = (typeof FORM_ERROR_CODES)[number];

export type FormErrors = Partial<
  Record<"topic" | "types" | "sourceUrl" | "sourceText", FormErrorCode>
>;

/**
 * Length exactly as the server's zod schema measures it (UTF-16 units), so the
 * counter in the form and the server's limit can never disagree.
 */
export const charCount = (value: string) => value.length;

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

export function validateForm(values: GeneratorFormValues): FormErrors {
  const errors: FormErrors = {};

  const topic = values.topic.trim();
  if (topic === "") errors.topic = "topic_required";
  else if (charCount(topic) > GENERATION_LIMITS.topicMax) errors.topic = "topic_too_long";

  if (values.types.length === 0) errors.types = "formats_required";

  if (values.sourceKind === "url") {
    const url = values.sourceUrl.trim();
    if (url === "") errors.sourceUrl = "url_required";
    else if (!isHttpsUrl(url)) errors.sourceUrl = "url_invalid";
  }

  if (values.sourceKind === "text") {
    const text = values.sourceText.trim();
    if (text === "") errors.sourceText = "text_required";
    else if (charCount(text) > GENERATION_LIMITS.sourceTextMax) errors.sourceText = "text_too_long";
  }

  return errors;
}

/** The request body for POST /api/generate. Only the active source is sent. */
export function toGenerateRequest(values: GeneratorFormValues): GenerateRequestInput {
  return {
    topic: values.topic.trim(),
    tone: values.tone,
    length: values.length,
    contentLanguage: values.contentLanguage,
    keywords: values.keywords,
    types: values.types,
    source:
      values.sourceKind === "url"
        ? { kind: "url", url: values.sourceUrl.trim() }
        : values.sourceKind === "text"
          ? { kind: "text", text: values.sourceText.trim() }
          : { kind: "none" },
  };
}
