import { describe, expect, it } from "vitest";

import { profileUpdateSchema } from "./schema";

const valid = {
  display_name: "  Ada Lovelace ",
  ui_language: "sr",
  default_content_language: "en",
  default_tone: "funny",
};

describe("profileUpdateSchema", () => {
  it("trims the display name and accepts valid defaults", () => {
    expect(profileUpdateSchema.parse(valid)).toEqual({ ...valid, display_name: "Ada Lovelace" });
  });

  it("turns an empty display name into null", () => {
    expect(profileUpdateSchema.parse({ ...valid, display_name: "   " }).display_name).toBeNull();
  });

  it("rejects a display name over 80 characters", () => {
    const result = profileUpdateSchema.safeParse({ ...valid, display_name: "x".repeat(81) });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toBe("name_too_long");
  });

  it("rejects unknown languages and tones", () => {
    expect(profileUpdateSchema.safeParse({ ...valid, ui_language: "de" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...valid, default_tone: "angry" }).success).toBe(false);
  });

  it("strips server-only columns smuggled into the form", () => {
    const parsed = profileUpdateSchema.parse({
      ...valid,
      plan: "pro",
      stripe_customer_id: "cus_fake",
      id: "00000000-0000-0000-0000-000000000000",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "default_content_language",
      "default_tone",
      "display_name",
      "ui_language",
    ]);
  });
});
