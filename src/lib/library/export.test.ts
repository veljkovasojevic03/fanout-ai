// @vitest-environment node
import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { fixtureText } from "@/lib/sample";

import {
  buildDocx,
  buildMarkdown,
  buildPlainText,
  exportFilename,
  toBlocks,
  type Block,
  type ExportInput,
} from "./export";

const BLOG = `---
meta_title: Ship every week
meta_description: Why small teams should ship weekly.
---

# Ship every week

An intro with **bold**, *italic* and a [link](https://example.com/guide).

## Why it works

- First point
- Second point
  - Nested point

1. Step one
2. Step two

> A quote worth keeping.

## Conclusion

Start this week.`;

const blog = (body = BLOG): ExportInput => ({
  type: "blog",
  title: "Ship every week",
  body,
  language: "en",
});

const textOf = (block: Block) =>
  "inlines" in block ? block.inlines.map((inline) => inline.text).join("") : "";

/** Reads one file out of a zip archive (a .docx is one) via its central directory. */
function unzip(archive: Uint8Array, name: string): string {
  const bytes = Buffer.from(archive);
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end, "zip end-of-central-directory record").toBeGreaterThan(-1);
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);

  for (let i = 0; i < count; i += 1) {
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const entryName = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (entryName === name) {
      const dataStart =
        localOffset +
        30 +
        bytes.readUInt16LE(localOffset + 26) +
        bytes.readUInt16LE(localOffset + 28);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} not found in archive`);
}

describe("toBlocks", () => {
  it("keeps headings as headings, with their levels", () => {
    const headings = toBlocks(blog()).filter((block) => block.kind === "heading");
    expect(
      headings.map((block) => [block.kind === "heading" && block.level, textOf(block)]),
    ).toEqual([
      [1, "Ship every week"],
      [2, "Why it works"],
      [2, "Conclusion"],
    ]);
  });

  it("turns the blog front block into labelled meta lines, not body text", () => {
    const blocks = toBlocks(blog());
    expect(blocks.slice(0, 2)).toEqual([
      { kind: "meta", label: "SEO title", value: "Ship every week" },
      { kind: "meta", label: "SEO description", value: "Why small teams should ship weekly." },
    ]);
    expect(blocks.some((block) => textOf(block).includes("meta_title"))).toBe(false);
  });

  it("labels the meta lines in the language of the piece", () => {
    const [first] = toBlocks({ ...blog(), language: "sr" });
    expect(first).toMatchObject({ kind: "meta", label: "SEO naslov" });
  });

  it("carries inline formatting and link targets", () => {
    const intro = toBlocks(blog()).find((block) => block.kind === "paragraph");
    expect(intro?.kind === "paragraph" && intro.inlines).toEqual([
      { text: "An intro with " },
      { text: "bold", bold: true },
      { text: ", " },
      { text: "italic", italic: true },
      { text: " and a " },
      { text: "link", href: "https://example.com/guide" },
      { text: "." },
    ]);
  });

  it("flattens lists with their depth, kind and a number per list", () => {
    const items = toBlocks(blog()).filter((block) => block.kind === "list_item");
    expect(
      items.map(
        (block) => block.kind === "list_item" && [block.ordered, block.depth, textOf(block)],
      ),
    ).toEqual([
      [false, 0, "First point"],
      [false, 0, "Second point"],
      [false, 1, "Nested point"],
      [true, 0, "Step one"],
      [true, 0, "Step two"],
    ]);
    const lists = items.map((block) => block.kind === "list_item" && block.list);
    expect(new Set(lists).size).toBe(3);
  });

  it("splits an email into Subject, Preheader and a Markdown body", () => {
    const blocks = toBlocks({
      type: "email",
      title: "Hello",
      language: "en",
      body: "Subject: Big news\nPreheader: Read this first\n\nHi there,\n\n**One** thing.",
    });
    expect(blocks.slice(0, 2)).toEqual([
      { kind: "meta", label: "Subject", value: "Big news" },
      { kind: "meta", label: "Preheader", value: "Read this first" },
    ]);
    expect(textOf(blocks[2]!)).toBe("Hi there,");
  });

  it("treats LinkedIn, Instagram and X pieces as plain text, never as Markdown", () => {
    const blocks = toBlocks({
      type: "x_thread",
      title: "Thread",
      language: "en",
      body: "1/ First post\nsecond line\n\n2/ Second post\n\n#tag # not a heading\n1. not a list",
    });
    expect(blocks.every((block) => block.kind === "paragraph")).toBe(true);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      inlines: [{ text: "1/ First post" }, { text: "", lineBreak: true }, { text: "second line" }],
    });
  });

  it("does not interpret raw HTML", () => {
    const blocks = toBlocks(blog("Hello <script>alert(1)</script> world\n\n<div>block</div>"));
    expect(blocks.map(textOf).join("|")).toBe(
      "Hello <script>alert(1)</script> world|<div>block</div>",
    );
  });

  it("handles every sample fixture without throwing", () => {
    for (const type of ["blog", "linkedin", "instagram", "email", "x_thread"] as const) {
      for (const language of ["en", "sr"] as const) {
        const body = fixtureText("product_launch", language, type);
        expect(toBlocks({ type, title: "t", body, language }).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildMarkdown", () => {
  it("returns the text as written, with normalised line endings and one final newline", () => {
    expect(buildMarkdown(blog("# Title\r\n\r\nBody  \r\n\r\n"))).toBe("# Title\n\nBody\n");
    expect(buildMarkdown(blog())).toBe(`${BLOG}\n`);
  });
});

describe("buildPlainText", () => {
  const text = buildPlainText(blog());

  it("has no Markdown syntax left", () => {
    expect(text).not.toMatch(/\*\*|^#|^---|\]\(/m);
    expect(text).toContain("An intro with bold, italic and a link (https://example.com/guide).");
  });

  it("writes meta lines, lists and quotes readably", () => {
    expect(text.startsWith("SEO title: Ship every week\nSEO description: Why small teams")).toBe(
      true,
    );
    expect(text).toContain("- First point\n- Second point\n  - Nested point");
    expect(text).toContain("1. Step one\n2. Step two");
    expect(text).toContain("> A quote worth keeping.");
    expect(text.endsWith("Start this week.\n")).toBe(true);
  });

  it("does not repeat a link whose text is its own address", () => {
    expect(buildPlainText(blog("See <https://example.com>."))).toBe("See https://example.com.\n");
  });

  it("leaves a plain-text piece exactly as written", () => {
    const body = "Hook line\n\nSecond paragraph\nwith a break\n\n#one #two";
    expect(buildPlainText({ type: "linkedin", title: "t", body, language: "en" })).toBe(
      `${body}\n`,
    );
  });
});

describe("buildDocx", () => {
  it("produces a Word file whose headings use the built-in heading styles", async () => {
    const file = await buildDocx(blog());
    // A .docx is a zip archive.
    expect(Array.from(file.slice(0, 2))).toEqual([0x50, 0x4b]);

    const xml = unzip(file, "word/document.xml");
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/>.*?Ship every week/s);
    expect(xml.match(/<w:pStyle w:val="Heading2"\/>/g)).toHaveLength(2);
    expect(xml).toContain("Why it works");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("SEO title: ");
    expect(xml).not.toContain("meta_title");
  });

  it("writes links as real hyperlinks, but only for web and mail addresses", async () => {
    const file = await buildDocx(
      blog("A [good](https://example.com/a) link and a [bad](javascript:alert(1)) one."),
    );
    const relationships = unzip(file, "word/_rels/document.xml.rels");
    expect(relationships).toContain("https://example.com/a");
    expect(relationships).not.toContain("javascript:");
    expect(unzip(file, "word/document.xml")).toContain("bad");
  });

  it("keeps Serbian letters and drops characters XML cannot hold", async () => {
    const file = await buildDocx(blog("# Šta je novo\n\nČekić, đak\u0000\u0008 i žaba."));
    const xml = unzip(file, "word/document.xml");
    expect(xml).toContain("Šta je novo");
    expect(xml).toContain("Čekić, đak i žaba.");
    expect(xml).not.toMatch(/[\u0000-\u0008]/);
  });

  it("escapes markup in the text instead of emitting it", async () => {
    const xml = unzip(await buildDocx(blog('Tom & Jerry <w:p> "quoted"')), "word/document.xml");
    expect(xml).toContain("Tom &amp; Jerry &lt;w:p&gt;");
  });
});

describe("exportFilename", () => {
  it("makes an ASCII slug from the title", () => {
    expect(exportFilename("Ship Every Week!", "docx")).toBe("ship-every-week.docx");
    expect(exportFilename("Šta je novo: čekić, žaba & đak", "md")).toBe(
      "sta-je-novo-cekic-zaba-djak.md",
    );
  });

  it("never returns an empty name or anything that could break a header", () => {
    expect(exportFilename("", "txt")).toBe("fanout-content.txt");
    expect(exportFilename("???", "txt")).toBe("fanout-content.txt");
    expect(exportFilename('a"b\r\nc/../d', "txt")).toBe("a-b-c-d.txt");
  });

  it("limits the length without leaving a trailing hyphen", () => {
    const name = exportFilename(`${"word ".repeat(30)}`, "txt");
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toMatch(/-\.txt$/);
  });
});
