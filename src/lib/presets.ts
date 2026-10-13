/**
 * Quick-generate presets (spec §4.8). The dashboard links to
 * `/app/generate?preset=<id>`; the generator reads the id and prefills its form.
 * Titles, descriptions and the suggested topic are translated (dashboard.presets.items).
 */
export const CONTENT_TYPES = ["blog", "linkedin", "instagram", "email", "x_thread"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const TONES = ["professional", "casual", "funny", "inspirational"] as const;
export type Tone = (typeof TONES)[number];

export const LENGTHS = ["short", "medium", "long"] as const;
export type Length = (typeof LENGTHS)[number];

export const PRESET_IDS = [
  "product_launch",
  "weekly_newsletter",
  "thought_leadership",
  "event_announcement",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type Preset = { tone: Tone; length: Length; types: readonly ContentType[] };

export const PRESETS: Record<PresetId, Preset> = {
  product_launch: { tone: "professional", length: "medium", types: CONTENT_TYPES },
  weekly_newsletter: { tone: "casual", length: "medium", types: ["email", "linkedin", "x_thread"] },
  thought_leadership: {
    tone: "inspirational",
    length: "medium",
    types: ["blog", "linkedin", "x_thread"],
  },
  event_announcement: {
    tone: "casual",
    length: "short",
    types: ["linkedin", "instagram", "email", "x_thread"],
  },
};

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && (PRESET_IDS as readonly string[]).includes(value);
}

/** Lengths a plan may use: everything up to and including its `max_length`. */
export function allowedLengths(maxLength: Length): Length[] {
  return LENGTHS.slice(0, LENGTHS.indexOf(maxLength) + 1);
}

/** Clamps a requested length to what the plan allows (e.g. Long → Medium on Free). */
export function clampLength(length: Length, maxLength: Length): Length {
  return LENGTHS.indexOf(length) <= LENGTHS.indexOf(maxLength) ? length : maxLength;
}
