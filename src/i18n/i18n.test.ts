import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import sr from "../../messages/sr.json";

import { compareCatalogues, icuArguments, richTags } from "./compare";
import { isAppLocale, matchAcceptLanguage, toAppLocale } from "./config";

describe("message catalogues", () => {
  it("en and sr have identical keys, arguments and tags", () => {
    expect(compareCatalogues(en, sr)).toEqual([]);
  });

  it("keeps Serbian in Latin script", () => {
    expect(JSON.stringify(sr)).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("compareCatalogues", () => {
  const base = { a: { title: "Hi {name}", link: "Go <link>home</link>" }, b: "Plain" };

  it("accepts a faithful translation", () => {
    const other = { a: { title: "Zdravo {name}", link: "Idi <link>kući</link>" }, b: "Obično" };
    expect(compareCatalogues(base, other)).toEqual([]);
  });

  it("reports missing and extra keys", () => {
    const other = { a: { title: "Zdravo {name}" }, b: "Obično", c: "Višak" };
    expect(compareCatalogues(base, other)).toEqual([
      { kind: "missing", key: "a.link" },
      { kind: "extra", key: "c" },
    ]);
  });

  it("reports a dropped ICU argument and a dropped rich-text tag", () => {
    const other = { a: { title: "Zdravo", link: "Idi kući" }, b: "Obično" };
    expect(compareCatalogues(base, other).map((p) => p.kind)).toEqual(["arguments", "tags"]);
  });

  it("reports empty translations", () => {
    const other = { a: { title: "Zdravo {name}", link: "Idi <link>kući</link>" }, b: " " };
    expect(compareCatalogues(base, other)).toEqual([{ kind: "empty", key: "b" }]);
  });
});

describe("message parsing", () => {
  it("finds ICU arguments but not plural branches", () => {
    const message = "{count, plural, one {# word} other {# words}} by {author}";
    expect(icuArguments(message)).toEqual(["author", "count"]);
  });

  it("finds rich-text tags", () => {
    expect(richTags("<signup>Sign up</signup> or <login>log in</login>")).toEqual([
      "login",
      "signup",
    ]);
  });
});

describe("locale helpers", () => {
  it("validates app locales", () => {
    expect(isAppLocale("sr")).toBe(true);
    expect(isAppLocale("sr-Latn")).toBe(false);
    expect(isAppLocale("de")).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
  });

  it("maps Intl locales back to app locales", () => {
    expect(toAppLocale("sr-Latn")).toBe("sr");
    expect(toAppLocale("en")).toBe("en");
  });

  it.each([
    ["sr-RS,sr;q=0.9,en;q=0.8", "sr"],
    ["en-US,en;q=0.9,sr;q=0.8", "en"],
    ["de-DE,de;q=0.9,sr;q=0.5,en;q=0.4", "sr"],
    ["fr-FR,fr;q=0.9", "en"],
    ["sr;q=0,en;q=0.5", "en"],
    ["", "en"],
    [null, "en"],
  ])("picks a locale from Accept-Language %j", (header, expected) => {
    expect(matchAcceptLanguage(header)).toBe(expected);
  });
});
