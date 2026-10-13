import type { AppLocale } from "@/i18n/config";
import { LIMITS } from "@/lib/content/contracts";
import { CONTENT_TYPES, type ContentType, type Tone } from "@/lib/presets";
import { FIXTURE_IDS, FIXTURES } from "@/lib/sample";

import type { RefineRequest } from "./schema";

/*
 * Sample-mode refine: canned, rule-based transformations (spec Phase 4.3).
 *
 * No model is called. These are honest stand-ins that show how the feature
 * behaves — the suggestion streams in, can be accepted, discarded and undone —
 * and the UI labels the result "Sample". They keep the structure of the piece
 * intact (front block, headings, Subject/Preheader lines, post numbers,
 * hashtags), so an accepted sample suggestion still passes the format check.
 *
 * Translation cannot be faked for arbitrary text. It works for the built-in
 * demo pieces, whose other-language version is already written; for anything
 * else `sampleRefine` returns null and the request is refused, uncounted.
 */

/** Lines that carry structure rather than prose; transformations leave them alone. */
function isStructural(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (/^(---+|#{1,6}\s|meta_title:|meta_description:|subject:|preheader:|```)/i.test(trimmed)) {
    return true;
  }
  // A line made only of hashtags.
  return trimmed.split(/\s+/).every((token) => /^#[\p{L}\p{N}_]+$/u.test(token));
}

/** Splits off list bullets and X post numbers ("3/ "), which must survive untouched. */
function splitMarker(line: string): [marker: string, prose: string] {
  const match = /^(\s*(?:\d{1,2}\/(?:\d{1,2})?|[-*+]|\d+\.)\s+)/.exec(line);
  return match ? [match[1]!, line.slice(match[1]!.length)] : ["", line];
}

const sentencesOf = (prose: string): string[] =>
  prose.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“„(])/u).filter(Boolean);

const wordsOf = (prose: string): string[] => prose.split(/\s+/).filter(Boolean);

function mapProse(text: string, transform: (prose: string, index: number) => string): string {
  let index = 0;
  return text
    .split("\n")
    .map((line) => {
      if (isStructural(line)) return line;
      const [marker, prose] = splitMarker(line);
      const next = transform(prose, index);
      index += 1;
      return marker + next;
    })
    .join("\n");
}

/** Keeps the first half of each paragraph's sentences; long single sentences are cut short. */
function shorten(text: string): string {
  const bySentence = mapProse(text, (prose) => {
    const sentences = sentencesOf(prose);
    return sentences.length < 2
      ? prose
      : sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
  });
  if (bySentence !== text) return bySentence;

  return mapProse(text, (prose) => {
    const words = wordsOf(prose);
    if (words.length <= 12) return prose;
    const kept = words.slice(0, Math.ceil(words.length * 0.6)).join(" ");
    return `${kept.replace(/[,;:–—-]+$/, "")}…`;
  });
}

const EXPANSIONS: Record<AppLocale, readonly string[]> = {
  en: [
    "A concrete example here would make the point land.",
    "This is the place for a short explanation of why it matters.",
    "One more detail would give the reader something to act on today.",
  ],
  sr: [
    "Ovde bi konkretan primer najbolje pokazao poentu.",
    "Na ovom mestu vredi ukratko objasniti zašto je to važno.",
    "Još jedan detalj dao bi čitaocu nešto što može da primeni već danas.",
  ],
};

const X_POST_ROOM = LIMITS.xPostChars - 10;

/** Adds one canned follow-up sentence to each substantial paragraph. */
function expand(text: string, type: ContentType, language: AppLocale): string {
  const additions = EXPANSIONS[language];
  let used = 0;
  return mapProse(text, (prose) => {
    if (wordsOf(prose).length < 8) return prose;
    const addition = additions[used % additions.length]!;
    // An X post has a hard limit: only add what still fits.
    if (type === "x_thread" && Array.from(prose).length + addition.length > X_POST_ROOM) {
      return prose;
    }
    used += 1;
    return `${prose.trimEnd()} ${addition}`;
  });
}

const OPENERS: Record<AppLocale, Record<Tone, string>> = {
  en: {
    professional: "To be precise: ",
    casual: "Honestly? ",
    funny: "Plot twist: ",
    inspirational: "Here is the part worth remembering: ",
  },
  sr: {
    professional: "Da budemo precizni: ",
    casual: "Iskreno? ",
    funny: "Obrt: ",
    inspirational: "Evo šta vredi zapamtiti: ",
  },
};

/** Opens the first paragraph in the requested register; the rest is left as written. */
function retone(text: string, tone: Tone, language: AppLocale): string {
  return mapProse(text, (prose, index) => (index === 0 ? OPENERS[language][tone] + prose : prose));
}

const comparable = (value: string) => value.replace(/\s+/g, " ").trim();

/** The other-language version of a built-in demo piece, if `text` is exactly one of them. */
function translateFixture(text: string, from: AppLocale, to: AppLocale): string | null {
  const wanted = comparable(text);
  for (const id of FIXTURE_IDS) {
    for (const type of CONTENT_TYPES) {
      if (comparable(FIXTURES[id][from][type]) === wanted) return FIXTURES[id][to][type].trim();
    }
  }
  return null;
}

type SampleRefineInput = Pick<
  RefineRequest,
  "action" | "text" | "language" | "tone" | "targetLanguage"
> & { type: ContentType };

/**
 * The canned result for a refine request, or null when sample mode has no
 * honest way to do it (translating text that is not a built-in demo piece).
 */
export function sampleRefine(input: SampleRefineInput): string | null {
  const text = input.text.replace(/\r\n?/g, "\n").trim();

  switch (input.action) {
    case "shorten":
      return shorten(text);
    case "expand":
      return expand(text, input.type, input.language);
    case "tone":
      return retone(text, input.tone ?? "professional", input.language);
    case "translate":
      return input.targetLanguage
        ? translateFixture(text, input.language, input.targetLanguage)
        : null;
  }
}
