import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import { CONTENT_LIMITS, contentUpdateSchema, copyTitle, LIBRARY_ERROR_CODES } from "./schema";
import {
  buildSearchQuery,
  DEFAULT_LIBRARY_PARAMS,
  hasActiveFilters,
  LIBRARY_PAGE_SIZE,
  libraryHref,
  libraryQuery,
  pageCount,
  parseLibraryParams,
  searchTerms,
  SEARCH_LIMITS,
} from "./search";
import { addTags, normalizeTag, normalizeTags, suggestTags, TAG_LIMITS } from "./tags";

describe("normalizeTag", () => {
  it("lower-cases, trims and collapses whitespace", () => {
    expect(normalizeTag("  Product   Launch ")).toBe("product launch");
    expect(normalizeTag("Šta\tJe\nNovo")).toBe("šta je novo");
  });

  it("drops a leading hash, but keeps one inside the tag", () => {
    expect(normalizeTag("#Marketing")).toBe("marketing");
    expect(normalizeTag("## q3")).toBe("q3");
    expect(normalizeTag("c#")).toBe("c#");
  });

  it("returns null when nothing usable is left", () => {
    expect(normalizeTag("")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("#")).toBeNull();
    expect(normalizeTag("​\u0000")).toBeNull();
  });

  it("clips to 32 characters, counted by code point, without a trailing space", () => {
    expect(normalizeTag("a".repeat(50))).toHaveLength(TAG_LIMITS.maxLength);
    expect(Array.from(normalizeTag("š".repeat(40))!)).toHaveLength(TAG_LIMITS.maxLength);
    // The 32nd character is a space: it must not survive as a trailing space.
    expect(normalizeTag(`${"a".repeat(31)} bcd`)).toBe("a".repeat(31));
  });

  it("removes invisible characters that would make two tags look the same", () => {
    expect(normalizeTag("news​")).toBe("news");
    expect(normalizeTag("ne\u0007ws")).toBe("ne ws");
  });
});

describe("normalizeTags / addTags", () => {
  it("de-duplicates after normalising and keeps first-seen order", () => {
    expect(normalizeTags(["Launch", "#launch", " LAUNCH ", "email"])).toEqual(["launch", "email"]);
  });

  it("caps the list at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    expect(normalizeTags(many)).toHaveLength(TAG_LIMITS.maxPerContent);
    expect(normalizeTags(many)[0]).toBe("tag-0");
  });

  it("adds several comma-separated tags at once", () => {
    expect(addTags(["a"], "B, c,, a ,#D")).toEqual(["a", "b", "c", "d"]);
    expect(addTags(["a"], "   ")).toEqual(["a"]);
  });
});

describe("suggestTags", () => {
  const known = ["launch", "newsletter", "pricing", "product", "relaunch"];

  it("offers the most used tags when nothing is typed, minus the ones already on the piece", () => {
    expect(suggestTags(known, ["launch"], "")).toEqual([
      "newsletter",
      "pricing",
      "product",
      "relaunch",
    ]);
  });

  it("puts prefix matches before contains matches", () => {
    expect(suggestTags(known, [], "LAU")).toEqual(["launch", "relaunch"]);
    expect(suggestTags(known, [], "pr")).toEqual(["pricing", "product"]);
  });

  it("respects the limit", () => {
    expect(suggestTags(known, [], "", 2)).toEqual(["launch", "newsletter"]);
  });
});

describe("buildSearchQuery (to_tsquery input)", () => {
  it("returns null when there is nothing to search for", () => {
    expect(buildSearchQuery("")).toBeNull();
    expect(buildSearchQuery("   ")).toBeNull();
    expect(buildSearchQuery("&|!:*()<>'\"")).toBeNull();
  });

  it("requires every word and matches each as a prefix", () => {
    expect(buildSearchQuery("pricing work")).toBe("pricing:* & work:*");
    expect(buildSearchQuery("Pricing")).toBe("pricing:*");
  });

  it("keeps Serbian letters and digits", () => {
    expect(buildSearchQuery("Šta je novo 2026")).toBe("šta:* & je:* & novo:* & 2026:*");
  });

  it("never lets tsquery syntax through", () => {
    const query = buildSearchQuery("foo & !bar | (baz) <-> 'qux':* \\ a:b")!;
    // Only our own operators remain: `term:*` joined by ` & `.
    expect(query).toMatch(/^[\p{L}\p{N}]+:\*( & [\p{L}\p{N}]+:\*)*$/u);
    expect(query).toBe("foo:* & bar:* & baz:* & qux:* & a:* & b:*");
  });

  it("splits punctuation the same way Postgres' parser does for our purposes", () => {
    expect(searchTerms("e-mail don't x_thread")).toEqual(["e", "mail", "don", "t", "x", "thread"]);
  });

  it("drops duplicate words and caps the number of terms and the input length", () => {
    expect(searchTerms("a a b A")).toEqual(["a", "b"]);
    const many = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
    expect(searchTerms(many)).toHaveLength(SEARCH_LIMITS.maxTerms);
    expect(searchTerms("x".repeat(500))[0]).toHaveLength(SEARCH_LIMITS.queryMax);
  });
});

describe("parseLibraryParams", () => {
  it("falls back to the defaults for missing or invalid values", () => {
    expect(parseLibraryParams({})).toEqual(DEFAULT_LIBRARY_PARAMS);
    expect(
      parseLibraryParams({ type: "tiktok", sort: "random", page: "-3", tag: "  ", q: "   " }),
    ).toEqual(DEFAULT_LIBRARY_PARAMS);
    expect(parseLibraryParams({ page: "abc" }).page).toBe(1);
    expect(parseLibraryParams({ page: "99999999" }).page).toBe(1);
  });

  it("reads valid values and normalises the tag and the query", () => {
    expect(
      parseLibraryParams({
        q: "  pricing   tips ",
        type: "blog",
        tag: "#Launch",
        sort: "oldest",
        page: "3",
      }),
    ).toEqual({ q: "pricing tips", type: "blog", tag: "launch", sort: "oldest", page: 3 });
  });

  it("uses the first value when a parameter is repeated", () => {
    expect(parseLibraryParams({ type: ["email", "blog"] }).type).toBe("email");
  });

  it("clips an over-long query", () => {
    expect(parseLibraryParams({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_LIMITS.queryMax);
  });
});

describe("library URLs and paging", () => {
  it("leaves defaults out of the query string", () => {
    expect(libraryQuery(DEFAULT_LIBRARY_PARAMS)).toEqual({});
    expect(libraryHref(DEFAULT_LIBRARY_PARAMS)).toBe("/app/library");
  });

  it("round-trips through the URL", () => {
    const params = {
      q: "šta & novo",
      type: "email",
      tag: "q3 plan",
      sort: "newest",
      page: 2,
    } as const;
    const href = libraryHref(params);
    expect(href.startsWith("/app/library?")).toBe(true);
    const parsed = parseLibraryParams(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(parsed).toEqual(params);
  });

  it("knows when filters are active (sorting and paging are not filters)", () => {
    expect(hasActiveFilters(DEFAULT_LIBRARY_PARAMS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_LIBRARY_PARAMS, sort: "oldest", page: 4 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_LIBRARY_PARAMS, tag: "a" })).toBe(true);
  });

  it("counts pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(LIBRARY_PAGE_SIZE)).toBe(1);
    expect(pageCount(LIBRARY_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("contentUpdateSchema (the autosave gate)", () => {
  const valid = {
    id: "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11",
    title: "  A   title ",
    body: "Text",
    language: "en",
    tags: ["Launch", "#launch", "News"],
  };

  it("cleans the title and normalises the tags", () => {
    const parsed = contentUpdateSchema.parse(valid);
    expect(parsed.title).toBe("A title");
    expect(parsed.tags).toEqual(["launch", "news"]);
  });

  it("rejects an empty or over-long title, an over-long body and unknown languages", () => {
    expect(contentUpdateSchema.safeParse({ ...valid, title: "   " }).success).toBe(false);
    expect(
      contentUpdateSchema.safeParse({ ...valid, title: "x".repeat(CONTENT_LIMITS.titleMax + 1) })
        .success,
    ).toBe(false);
    expect(
      contentUpdateSchema.safeParse({ ...valid, body: "x".repeat(CONTENT_LIMITS.bodyMax + 1) })
        .success,
    ).toBe(false);
    expect(contentUpdateSchema.safeParse({ ...valid, language: "de" }).success).toBe(false);
    expect(contentUpdateSchema.safeParse({ ...valid, id: "nope" }).success).toBe(false);
  });

  it("allows an empty body (a piece can be cleared and rewritten)", () => {
    expect(contentUpdateSchema.safeParse({ ...valid, body: "" }).success).toBe(true);
  });
});

describe("copyTitle", () => {
  it("appends the suffix", () => {
    expect(copyTitle("Launch post", "copy")).toBe("Launch post (copy)");
  });

  it("clips a long title so the result still fits and the suffix survives", () => {
    const title = copyTitle("x".repeat(CONTENT_LIMITS.titleMax), "kopija");
    expect(Array.from(title)).toHaveLength(CONTENT_LIMITS.titleMax);
    expect(title.endsWith(" (kopija)")).toBe(true);
  });
});

describe("message catalogue", () => {
  it.each([
    ["en", en],
    ["sr", sr],
  ])("%s has a message for every library error code", (_name, messages) => {
    expect(Object.keys(messages.editor.errors).sort()).toEqual([...LIBRARY_ERROR_CODES].sort());
  });
});
