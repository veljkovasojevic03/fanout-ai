import type { AppLocale } from "@/i18n/config";
import type { ContentSource, GenerationBrief, StreamChunk } from "@/lib/generation/types";
import type { ContentType, PresetId } from "@/lib/presets";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import { habitTracker } from "./fixtures/habit-tracker";
import { pricingWorkshop } from "./fixtures/pricing-workshop";
import { shipWeekly } from "./fixtures/ship-weekly";
import type { Fixture } from "./fixtures/types";
import { renderTemplate } from "./template";

/*
 * Sample mode: pre-written content, streamed so it looks and feels like the
 * real thing. Nothing here calls an AI model, and the UI always labels the
 * result "Sample".
 */

/** Hand-written fixtures, keyed by the dashboard preset whose topic they answer. */
export const FIXTURES = {
  product_launch: habitTracker,
  thought_leadership: shipWeekly,
  event_announcement: pricingWorkshop,
} as const satisfies Partial<Record<PresetId, Fixture>>;

export type FixtureId = keyof typeof FIXTURES;
export const FIXTURE_IDS = Object.keys(FIXTURES) as FixtureId[];

const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A fixture answers its preset's topic in either UI language. */
const TOPIC_TO_FIXTURE = new Map<string, FixtureId>(
  FIXTURE_IDS.flatMap((id) => [
    [normalise(en.dashboard.presets.items[id].topic), id],
    [normalise(sr.dashboard.presets.items[id].topic), id],
  ]),
);

export function findFixture(topic: string): FixtureId | null {
  return TOPIC_TO_FIXTURE.get(normalise(topic)) ?? null;
}

/**
 * The sample text for one piece: a hand-written fixture when the topic is one of
 * the presets, otherwise the generic template with the topic and keywords
 * filled in. The content language picks the fixture's language, independently
 * of the language the topic was typed in.
 */
export function sampleText(brief: GenerationBrief, type: ContentType): string {
  const fixtureId = findFixture(brief.topic);
  if (fixtureId) return FIXTURES[fixtureId][brief.language][type].trim();

  return renderTemplate({
    topic: brief.topic,
    tone: brief.tone,
    keywords: brief.keywords,
    language: brief.language,
  })[type].trim();
}

export function fixtureText(id: FixtureId, language: AppLocale, type: ContentType): string {
  return FIXTURES[id][language][type].trim();
}

/** Small, fast, well-distributed PRNG. Deterministic for a given seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: turns the string seed into a 32-bit number. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const SAMPLE_DELAY_MS = { min: 15, max: 40 } as const;

/** Words with their trailing whitespace, so joining the chunks reproduces the text exactly. */
export function chunkWords(text: string): string[] {
  return text.match(/\s*\S+\s*/g) ?? [];
}

/** The delay before each word, in ms. Pure, so tests can assert determinism. */
export function wordDelays(count: number, seed: string): number[] {
  const random = mulberry32(hashSeed(seed));
  const span = SAMPLE_DELAY_MS.max - SAMPLE_DELAY_MS.min;
  return Array.from({ length: count }, () => SAMPLE_DELAY_MS.min + Math.round(random() * span));
}

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Streams `text` one word at a time with 15–40 ms of seeded jitter between
 * words. Stops promptly when the signal aborts. Ends with a zero-token usage
 * chunk — sample output costs nothing.
 */
export async function* simulateStream(
  text: string,
  seed: string,
  signal: AbortSignal,
  sleep: Sleep = realSleep,
): AsyncGenerator<StreamChunk> {
  const words = chunkWords(text);
  const delays = wordDelays(words.length, seed);

  for (let i = 0; i < words.length; i += 1) {
    await sleep(delays[i]!, signal);
    if (signal.aborted) return;
    yield { type: "delta", text: words[i]! };
  }

  yield { type: "usage", inputTokens: 0, outputTokens: 0 };
}

export const sampleSource: ContentSource = ({ brief, type, seed, signal }) =>
  simulateStream(sampleText(brief, type), seed, signal);
