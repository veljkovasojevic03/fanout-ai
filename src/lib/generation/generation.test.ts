import { describe, expect, it, vi } from "vitest";

import { addKeywords } from "@/components/generator/keyword-input";
import { CONTRACT_WARNING_CODES } from "@/lib/content/contracts";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import { GENERATE_ERROR_CODES, isGenerateErrorCode, toGenerateErrorCode } from "./errors";
import {
  FORM_ERROR_CODES,
  toGenerateRequest,
  validateForm,
  type GeneratorFormValues,
} from "./form";
import { GENERATION_LIMITS, generateRequestSchema, streamRequestSchema } from "./schema";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const form = (overrides: Partial<GeneratorFormValues> = {}): GeneratorFormValues => ({
  topic: "How to brew better coffee",
  tone: "casual",
  length: "medium",
  contentLanguage: "en",
  keywords: ["espresso"],
  types: ["blog", "linkedin"],
  sourceKind: "none",
  sourceUrl: "",
  sourceText: "",
  ...overrides,
});

describe("message catalogue", () => {
  const sorted = (values: readonly string[]) => [...values].sort();

  it.each([
    ["en", en],
    ["sr", sr],
  ])("%s has a message for every error, warning and form-error code", (_name, messages) => {
    expect(sorted(Object.keys(messages.generate.errors))).toEqual(sorted(GENERATE_ERROR_CODES));
    expect(sorted(Object.keys(messages.generate.form.errors))).toEqual(sorted(FORM_ERROR_CODES));
    const warningKeys = Object.keys(messages.generate.warnings).filter((key) => key !== "title");
    expect(sorted(warningKeys)).toEqual(sorted(CONTRACT_WARNING_CODES));
  });

  it("collapses unknown codes instead of passing them to the UI", () => {
    expect(isGenerateErrorCode("quota_exhausted")).toBe(true);
    expect(toGenerateErrorCode("quota_exhausted", "server_error")).toBe("quota_exhausted");
    expect(toGenerateErrorCode("<img onerror=x>", "server_error")).toBe("server_error");
    expect(toGenerateErrorCode(undefined, "stream_failed")).toBe("stream_failed");
  });
});

describe("generateRequestSchema (the server-side gate)", () => {
  const valid = toGenerateRequest(form());

  it("accepts a valid request and applies defaults", () => {
    const parsed = generateRequestSchema.parse({
      ...valid,
      keywords: undefined,
      source: undefined,
    });
    expect(parsed.keywords).toEqual([]);
    expect(parsed.source).toEqual({ kind: "none" });
  });

  it("trims the topic and rejects an empty or over-long one", () => {
    expect(generateRequestSchema.parse({ ...valid, topic: "  Hi  " }).topic).toBe("Hi");
    expect(generateRequestSchema.safeParse({ ...valid, topic: "   " }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, topic: "x".repeat(301) }).success).toBe(
      false,
    );
    expect(generateRequestSchema.safeParse({ ...valid, topic: "x".repeat(300) }).success).toBe(
      true,
    );
  });

  it("allows at most 8 keywords of at most 40 characters, and de-duplicates them", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `k${i}`);
    expect(generateRequestSchema.safeParse({ ...valid, keywords: nine }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, keywords: ["x".repeat(41)] }).success).toBe(
      false,
    );
    expect(
      generateRequestSchema.parse({ ...valid, keywords: [" a ", "a", "b  c"] }).keywords,
    ).toEqual(["a", "b c"]);
  });

  it("requires at least one known type and de-duplicates them", () => {
    expect(generateRequestSchema.safeParse({ ...valid, types: [] }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, types: ["podcast"] }).success).toBe(false);
    expect(generateRequestSchema.parse({ ...valid, types: ["blog", "blog"] }).types).toEqual([
      "blog",
    ]);
  });

  it("rejects unknown tones, lengths and languages", () => {
    expect(generateRequestSchema.safeParse({ ...valid, tone: "angry" }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, length: "epic" }).success).toBe(false);
    expect(generateRequestSchema.safeParse({ ...valid, contentLanguage: "de" }).success).toBe(
      false,
    );
  });

  it("caps pasted source text at 8000 characters", () => {
    const text = (length: number) => ({
      ...valid,
      source: { kind: "text", text: "x".repeat(length) },
    });
    expect(generateRequestSchema.safeParse(text(GENERATION_LIMITS.sourceTextMax)).success).toBe(
      true,
    );
    expect(generateRequestSchema.safeParse(text(GENERATION_LIMITS.sourceTextMax + 1)).success).toBe(
      false,
    );
  });

  it("drops fields the client has no business sending", () => {
    const parsed = generateRequestSchema.parse({
      ...valid,
      mode: "live",
      model: "claude-opus-5-5",
      plan: "pro",
      userId: "someone-else",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "contentLanguage",
      "keywords",
      "length",
      "source",
      "tone",
      "topic",
      "types",
    ]);
  });

  it("requires a UUID and a known type to open a stream", () => {
    const id = "3f0b8c1e-6d2a-4b7e-9c1d-2a5e8f7b6c4d";
    expect(streamRequestSchema.safeParse({ generationId: id, type: "blog" }).success).toBe(true);
    expect(streamRequestSchema.safeParse({ generationId: "1", type: "blog" }).success).toBe(false);
    expect(streamRequestSchema.safeParse({ generationId: id, type: "x" }).success).toBe(false);
  });
});

describe("form validation (client-side feedback)", () => {
  it("accepts a filled-in form", () => {
    expect(validateForm(form())).toEqual({});
  });

  it("flags a missing topic, an over-long topic and no formats", () => {
    expect(validateForm(form({ topic: "  " }))).toEqual({ topic: "topic_required" });
    expect(validateForm(form({ topic: "x".repeat(301) }))).toEqual({ topic: "topic_too_long" });
    expect(validateForm(form({ types: [] }))).toEqual({ types: "formats_required" });
  });

  it("validates only the active source", () => {
    expect(validateForm(form({ sourceKind: "none", sourceUrl: "nonsense" }))).toEqual({});
    expect(validateForm(form({ sourceKind: "url", sourceUrl: "" }))).toEqual({
      sourceUrl: "url_required",
    });
    expect(validateForm(form({ sourceKind: "text", sourceText: "" }))).toEqual({
      sourceText: "text_required",
    });
  });

  it.each(["http://example.com", "example.com", "ftp://example.com", "https://localhost"])(
    "rejects the source URL %s",
    (sourceUrl) => {
      expect(validateForm(form({ sourceKind: "url", sourceUrl }))).toEqual({
        sourceUrl: "url_invalid",
      });
    },
  );

  it("sends only the active source to the server", () => {
    const values = form({
      sourceKind: "text",
      sourceText: " notes ",
      sourceUrl: "https://a.example",
    });
    expect(toGenerateRequest(values).source).toEqual({ kind: "text", text: "notes" });
    expect(toGenerateRequest(form({ sourceUrl: "https://a.example" })).source).toEqual({
      kind: "none",
    });
  });

  it("produces a request the server schema accepts", () => {
    const request = toGenerateRequest(
      form({ sourceKind: "url", sourceUrl: "https://example.com/post" }),
    );
    expect(generateRequestSchema.safeParse(request).success).toBe(true);
  });
});

describe("addKeywords", () => {
  it("adds trimmed keywords and splits on commas", () => {
    expect(addKeywords(["a"], " b ,  c  d ")).toEqual(["a", "b", "c d"]);
  });

  it("ignores blanks and case-insensitive duplicates", () => {
    expect(addKeywords(["Coffee"], "coffee, ,COFFEE,tea")).toEqual(["Coffee", "tea"]);
  });

  it("stops at 8 keywords and clips each to 40 characters", () => {
    const many = Array.from({ length: 12 }, (_, i) => `k${i}`).join(",");
    expect(addKeywords([], many)).toHaveLength(8);
    expect(addKeywords([], "x".repeat(60))[0]).toHaveLength(40);
  });
});
