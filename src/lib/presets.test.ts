import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";

import {
  allowedLengths,
  clampLength,
  CONTENT_TYPES,
  isPresetId,
  PRESET_IDS,
  PRESETS,
} from "./presets";

describe("presets", () => {
  it("has copy for every preset id, and no orphaned copy", () => {
    expect(Object.keys(en.dashboard.presets.items).sort()).toEqual([...PRESET_IDS].sort());
  });

  it("only uses known content types and at least one per preset", () => {
    for (const id of PRESET_IDS) {
      const { types } = PRESETS[id];
      expect(types.length).toBeGreaterThan(0);
      expect(types.every((type) => CONTENT_TYPES.includes(type))).toBe(true);
    }
  });

  it("keeps every suggested topic within the 300-character topic limit", () => {
    for (const id of PRESET_IDS) {
      expect(en.dashboard.presets.items[id].topic.length).toBeLessThanOrEqual(300);
    }
  });

  it("validates preset ids from the query string", () => {
    expect(isPresetId("product_launch")).toBe(true);
    expect(isPresetId("__proto__")).toBe(false);
    expect(isPresetId(["product_launch"])).toBe(false);
  });
});

describe("plan length gating", () => {
  it("lists the lengths a plan may use", () => {
    expect(allowedLengths("short")).toEqual(["short"]);
    expect(allowedLengths("medium")).toEqual(["short", "medium"]);
    expect(allowedLengths("long")).toEqual(["short", "medium", "long"]);
  });

  it("clamps a preset's length to the plan's maximum", () => {
    expect(clampLength("long", "medium")).toBe("medium");
    expect(clampLength("short", "medium")).toBe("short");
    expect(clampLength("long", "long")).toBe("long");
  });
});
