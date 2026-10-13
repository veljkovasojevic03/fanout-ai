import { describe, expect, it } from "vitest";

import { APP_LOCALES } from "@/i18n/config";
import { parseXThread, validateContent } from "@/lib/content/contracts";
import type { GenerationBrief, StreamChunk } from "@/lib/generation/types";
import { CONTENT_TYPES, TONES } from "@/lib/presets";

import {
  chunkWords,
  findFixture,
  FIXTURE_IDS,
  fixtureText,
  SAMPLE_DELAY_MS,
  sampleText,
  simulateStream,
  wordDelays,
} from "./index";
import { renderTemplate, toHashtag } from "./template";

const brief = (overrides: Partial<GenerationBrief> = {}): GenerationBrief => ({
  topic: "How to brew better coffee at home",
  tone: "casual",
  length: "short",
  language: "en",
  keywords: [],
  sourceText: null,
  ...overrides,
});

describe("fixtures", () => {
  it("cover at least 3 topics × 2 languages × 5 types", () => {
    expect(FIXTURE_IDS.length).toBeGreaterThanOrEqual(3);
    for (const id of FIXTURE_IDS) {
      for (const language of APP_LOCALES) {
        for (const type of CONTENT_TYPES) {
          expect(fixtureText(id, language, type).length).toBeGreaterThan(100);
        }
      }
    }
  });

  const cases = FIXTURE_IDS.flatMap((id) =>
    APP_LOCALES.flatMap((language) => CONTENT_TYPES.map((type) => [id, language, type] as const)),
  );

  it.each(cases)("%s / %s / %s obeys its content contract", (id, language, type) => {
    expect(validateContent(type, fixtureText(id, language, type))).toEqual([]);
  });

  it("keeps Serbian fixtures in Latin script", () => {
    for (const id of FIXTURE_IDS) {
      for (const type of CONTENT_TYPES) {
        expect(fixtureText(id, "sr", type)).not.toMatch(/[Ѐ-ӿ]/);
      }
    }
  });

  it("writes different text for each language", () => {
    for (const id of FIXTURE_IDS) {
      expect(fixtureText(id, "sr", "linkedin")).not.toBe(fixtureText(id, "en", "linkedin"));
    }
  });
});

describe("fixture selection", () => {
  it("matches a preset topic regardless of case, punctuation and UI language", () => {
    expect(findFixture("Why small teams should ship every week")).toBe("thought_leadership");
    expect(findFixture("  WHY small teams should ship every week!! ")).toBe("thought_leadership");
    expect(findFixture("Zašto mali timovi treba da isporučuju svake nedelje")).toBe(
      "thought_leadership",
    );
    expect(findFixture("Why big teams should ship every week")).toBeNull();
  });

  it("picks the fixture's language from the content language, not the topic's", () => {
    const text = sampleText(
      brief({ topic: "Why small teams should ship every week", language: "sr" }),
      "linkedin",
    );
    expect(text).toBe(fixtureText("thought_leadership", "sr", "linkedin"));
  });

  it("falls back to the generic template for a custom topic", () => {
    const text = sampleText(brief(), "linkedin");
    expect(text).toContain("How to brew better coffee at home");
    expect(text.toLowerCase()).toContain("sample");
  });
});

describe("generic template", () => {
  const topics = {
    tiny: "AI",
    typical: "How to brew better coffee at home",
    longest: "Ž".repeat(300),
    wordy: Array.from({ length: 60 }, (_, i) => `word${i}`)
      .join(" ")
      .slice(0, 300),
  };
  const keywordSets = {
    none: [],
    eight: Array.from({ length: 8 }, (_, i) => `keyword number ${i} with a long tail of text`),
    odd: ["C++", "  ", "Ünïcödé čćžšđ", "#already", "!!!"],
  };

  const cases = APP_LOCALES.flatMap((language) =>
    Object.entries(topics).flatMap(([topicName, topic]) =>
      Object.entries(keywordSets).map(
        ([keywordName, keywords]) => [language, topicName, keywordName, topic, keywords] as const,
      ),
    ),
  );

  it.each(cases)(
    "%s output obeys every contract (%s topic, %s keywords)",
    (language, _topicName, _keywordName, topic, keywords) => {
      for (const tone of TONES) {
        const rendered = renderTemplate({ topic, tone, keywords, language });
        for (const type of CONTENT_TYPES) {
          expect(validateContent(type, rendered[type]), `${type} / ${tone}`).toEqual([]);
        }
      }
    },
  );

  it("says plainly that it is a sample, in the content language", () => {
    const enText = renderTemplate({ topic: "X", tone: "casual", keywords: [], language: "en" });
    const srText = renderTemplate({ topic: "X", tone: "casual", keywords: [], language: "sr" });
    for (const type of CONTENT_TYPES) {
      expect(enText[type].toLowerCase()).toContain("sample");
      expect(srText[type].toLowerCase()).toContain("primer");
      expect(srText[type]).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it("shows the user's keywords", () => {
    const rendered = renderTemplate({
      topic: "Coffee",
      tone: "casual",
      keywords: ["espresso", "home brewing"],
      language: "en",
    });
    expect(rendered.linkedin).toContain("espresso, home brewing");
    expect(rendered.instagram).toContain("#espresso #homebrewing");
  });

  it("builds safe hashtags", () => {
    expect(toHashtag("Content Marketing")).toBe("#contentmarketing");
    expect(toHashtag("C++")).toBe("#c");
    expect(toHashtag("!!!")).toBeNull();
    expect(toHashtag("čćžšđ")).toBe("#čćžšđ");
  });
});

describe("stream simulator", () => {
  const collect = async (text: string, seed: string, signal = new AbortController().signal) => {
    const chunks: StreamChunk[] = [];
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    for await (const chunk of simulateStream(text, seed, signal, sleep)) chunks.push(chunk);
    return { chunks, waits };
  };

  it("reproduces the text exactly, one word per chunk", async () => {
    const text = fixtureText("product_launch", "sr", "x_thread");
    const { chunks } = await collect(text, "seed");
    const deltas = chunks.flatMap((c) => (c.type === "delta" ? [c.text] : []));

    expect(deltas.join("")).toBe(text);
    expect(deltas).toHaveLength(chunkWords(text).length);
    expect(parseXThread(deltas.join(""))).toHaveLength(7);
  });

  it("ends with a zero-cost usage chunk", async () => {
    const { chunks } = await collect("one two three", "seed");
    expect(chunks.at(-1)).toEqual({ type: "usage", inputTokens: 0, outputTokens: 0 });
  });

  it("uses 15–40 ms of jitter between words", async () => {
    const { waits } = await collect(fixtureText("product_launch", "en", "blog"), "seed");
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(SAMPLE_DELAY_MS.min);
    expect(Math.max(...waits)).toBeLessThanOrEqual(SAMPLE_DELAY_MS.max);
    // Jitter, not a constant: a healthy spread of distinct values.
    expect(new Set(waits).size).toBeGreaterThan(10);
  });

  it("is deterministic per seed and different across seeds", () => {
    expect(wordDelays(50, "gen-1:blog:1")).toEqual(wordDelays(50, "gen-1:blog:1"));
    expect(wordDelays(50, "gen-1:blog:1")).not.toEqual(wordDelays(50, "gen-1:blog:2"));
    expect(wordDelays(50, "gen-1:blog:1")).not.toEqual(wordDelays(50, "gen-2:blog:1"));
  });

  it("stops as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const chunks: StreamChunk[] = [];
    const sleep = async () => {
      if (chunks.length === 3) controller.abort();
    };
    for await (const chunk of simulateStream("a b c d e f g h", "seed", controller.signal, sleep)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      { type: "delta", text: "a " },
      { type: "delta", text: "b " },
      { type: "delta", text: "c " },
    ]);
  });

  it("finishes the longest fixture well inside the 60 s function limit", () => {
    let worst = 0;
    for (const id of FIXTURE_IDS) {
      for (const language of APP_LOCALES) {
        for (const type of CONTENT_TYPES) {
          const words = chunkWords(fixtureText(id, language, type)).length;
          worst = Math.max(worst, words * SAMPLE_DELAY_MS.max);
        }
      }
    }
    expect(worst).toBeLessThan(30_000);
  });
});
