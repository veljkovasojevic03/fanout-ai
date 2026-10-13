import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/library?tag=growth&page=2", "/app/library?tag=growth&page=2"],
    ["/update-password", "/update-password"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/app"],
    ["a protocol-relative URL", "//evil.example/app"],
    ["a backslash host", "/\\evil.example"],
    ["a mixed-slash host", "/\\/evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "app"],
    ["an embedded tab", "/\t/evil.example"],
    ["an embedded newline", "/app\n//evil.example"],
    ["an empty string", ""],
    ["a non-string", ["/app"]],
    ["null", null],
    ["undefined", undefined],
    ["an over-long value", `/${"a".repeat(600)}`],
  ])("rejects %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/app");
  });

  it("uses the provided fallback", () => {
    expect(safeNextPath("https://evil.example", "/login")).toBe("/login");
  });

  it("drops the fragment and normalises dot segments", () => {
    expect(safeNextPath("/app/../login#x")).toBe("/login");
  });
});
