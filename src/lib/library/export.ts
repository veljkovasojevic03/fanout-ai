import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";
import type { PhrasingContent, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { AppLocale } from "@/i18n/config";
import { parseBlog, parseEmail } from "@/lib/content/contracts";
import type { ContentType } from "@/lib/presets";

/*
 * Export builders (spec §4.4): .txt, .md and .docx.
 *
 * All three start from the same list of blocks, so a heading in the editor is
 * a heading in Word and a clean line in plain text. Blog posts and email
 * bodies are Markdown; LinkedIn, Instagram and X pieces are plain text whose
 * line breaks matter, so they are never run through the Markdown parser
 * (which would turn "1." into a list and "#tag" lines into headings).
 *
 * Pure functions, no I/O — the route handler adds the HTTP part.
 */

export const EXPORT_FORMATS = ["txt", "md", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type ExportInput = {
  type: ContentType;
  title: string;
  body: string;
  language: AppLocale;
};

export type Inline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
  /** A line break inside a paragraph; `text` is empty. */
  lineBreak?: boolean;
};

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list_item"; ordered: boolean; depth: number; list: number; inlines: Inline[] }
  | { kind: "quote"; inlines: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  /** A labelled line that is not part of the running text: SEO fields, subject, preheader. */
  | { kind: "meta"; label: string; value: string };

/** Labels for the header fields, in the language of the piece itself. */
const META_LABELS: Record<AppLocale, Record<"metaTitle" | "metaDescription", string>> = {
  en: { metaTitle: "SEO title", metaDescription: "SEO description" },
  sr: { metaTitle: "SEO naslov", metaDescription: "SEO opis" },
};

/** Characters that are not allowed in XML 1.0 make Word refuse the whole file. */
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

const normaliseNewlines = (text: string) => text.replace(/\r\n?/g, "\n");

type Marks = Omit<Inline, "text" | "lineBreak">;

function inlinesOf(nodes: readonly PhrasingContent[], marks: Marks = {}): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    switch (node.type) {
      case "text":
        return [{ ...marks, text: clean(node.value) }];
      case "strong":
        return inlinesOf(node.children, { ...marks, bold: true });
      case "emphasis":
        return inlinesOf(node.children, { ...marks, italic: true });
      case "delete":
        return inlinesOf(node.children, { ...marks, strike: true });
      case "inlineCode":
        return [{ ...marks, code: true, text: clean(node.value) }];
      case "link":
        return inlinesOf(node.children, { ...marks, href: node.url });
      case "break":
        return [{ text: "", lineBreak: true }];
      case "image":
        return node.alt ? [{ ...marks, text: clean(node.alt) }] : [];
      case "html":
        // Raw HTML is never interpreted; it is exported as the text it is.
        return [{ ...marks, text: clean(node.value) }];
      default:
        return "children" in node ? inlinesOf(node.children as PhrasingContent[], marks) : [];
    }
  });
}

function markdownBlocks(markdown: string): Block[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const blocks: Block[] = [];
  let lists = 0;

  const walk = (nodes: readonly RootContent[], depth: number, quoted: boolean) => {
    for (const node of nodes) {
      switch (node.type) {
        case "heading":
          blocks.push({ kind: "heading", level: node.depth, inlines: inlinesOf(node.children) });
          break;
        case "paragraph":
          blocks.push({ kind: quoted ? "quote" : "paragraph", inlines: inlinesOf(node.children) });
          break;
        case "blockquote":
          walk(node.children, depth, true);
          break;
        case "list": {
          const list = (lists += 1);
          for (const item of node.children) {
            const [head, ...rest] = item.children;
            const inlines = head?.type === "paragraph" ? inlinesOf(head.children) : [];
            blocks.push({
              kind: "list_item",
              ordered: node.ordered === true,
              depth,
              list,
              inlines,
            });
            walk(head?.type === "paragraph" ? rest : item.children, depth + 1, quoted);
          }
          break;
        }
        case "code":
          blocks.push({ kind: "code", text: clean(node.value) });
          break;
        case "thematicBreak":
          blocks.push({ kind: "rule" });
          break;
        case "table":
          for (const row of node.children) {
            const cells = row.children.map((cell) => inlinesOf(cell.children));
            blocks.push({
              kind: "paragraph",
              inlines: cells.flatMap((cell, index) =>
                index === 0 ? cell : [{ text: " | " }, ...cell],
              ),
            });
          }
          break;
        case "html":
          blocks.push({ kind: "paragraph", inlines: [{ text: clean(node.value) }] });
          break;
        default:
          break;
      }
    }
  };

  walk(tree.children, 0, false);
  return blocks;
}

/** Plain-text pieces: blank lines separate paragraphs, single newlines are kept as line breaks. */
function plainBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      kind: "paragraph" as const,
      inlines: paragraph
        .split("\n")
        .flatMap((line, index): Inline[] =>
          index === 0
            ? [{ text: clean(line) }]
            : [{ text: "", lineBreak: true }, { text: clean(line) }],
        ),
    }));
}

/** The piece as a flat list of blocks — the shared input of the .txt and .docx builders. */
export function toBlocks(input: ExportInput): Block[] {
  // Cleaned before parsing: the Markdown parser would turn a NUL into U+FFFD.
  const body = clean(normaliseNewlines(input.body));

  if (input.type === "blog") {
    const blog = parseBlog(body);
    const labels = META_LABELS[input.language];
    const meta: Block[] = [];
    if (blog.metaTitle) {
      meta.push({ kind: "meta", label: labels.metaTitle, value: clean(blog.metaTitle) });
    }
    if (blog.metaDescription) {
      meta.push({
        kind: "meta",
        label: labels.metaDescription,
        value: clean(blog.metaDescription),
      });
    }
    return [...meta, ...markdownBlocks(blog.body)];
  }

  if (input.type === "email") {
    const email = parseEmail(body);
    const meta: Block[] = [];
    // "Subject" and "Preheader" are part of the content contract, in every language.
    if (email.subject) meta.push({ kind: "meta", label: "Subject", value: clean(email.subject) });
    if (email.preheader) {
      meta.push({ kind: "meta", label: "Preheader", value: clean(email.preheader) });
    }
    return [...meta, ...markdownBlocks(email.body)];
  }

  return plainBlocks(body);
}

/** `.md`: the Markdown exactly as written, with normalised line endings. */
export function buildMarkdown(input: ExportInput): string {
  return `${normaliseNewlines(input.body).trim()}\n`;
}

const isWebLink = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

function plainInlines(inlines: readonly Inline[]): string {
  let out = "";
  for (let i = 0; i < inlines.length; i += 1) {
    const inline = inlines[i]!;
    if (inline.lineBreak) {
      out += "\n";
      continue;
    }
    out += inline.text;
    // Write a link's address once, after the last run of its text.
    const href = inline.href;
    if (href && inlines[i + 1]?.href !== href) {
      let start = i;
      while (start > 0 && inlines[start - 1]?.href === href) start -= 1;
      const label = inlines
        .slice(start, i + 1)
        .map((part) => part.text)
        .join("");
      if (label.trim() !== href.trim()) out += ` (${href})`;
    }
  }
  return out;
}

/** `.txt`: no Markdown syntax left — headings, lists and links read as ordinary text. */
export function buildPlainText(input: ExportInput): string {
  const blocks = toBlocks(input);
  const counters = new Map<number, number>();
  const parts: string[] = [];

  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    // List items and header fields sit on consecutive lines; everything else gets a blank line.
    const tight =
      previous !== undefined &&
      previous.kind === block.kind &&
      (block.kind === "list_item" || block.kind === "meta");
    if (index > 0) parts.push(tight ? "\n" : "\n\n");

    switch (block.kind) {
      case "heading":
      case "paragraph":
        parts.push(plainInlines(block.inlines));
        break;
      case "quote":
        parts.push(
          plainInlines(block.inlines)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        );
        break;
      case "list_item": {
        const number = (counters.get(block.list) ?? 0) + 1;
        counters.set(block.list, number);
        const marker = block.ordered ? `${number}.` : "-";
        parts.push(`${"  ".repeat(block.depth)}${marker} ${plainInlines(block.inlines)}`);
        break;
      }
      case "code":
        parts.push(block.text);
        break;
      case "rule":
        parts.push("----------");
        break;
      case "meta":
        parts.push(`${block.label}: ${block.value}`);
        break;
    }
  });

  return `${parts.join("").trim()}\n`;
}

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
} as const;

const ORDERED_LIST = "fanout-ordered";
const MAX_LIST_LEVEL = 8;

function docxRuns(inlines: readonly Inline[]): ParagraphChild[] {
  return inlines.map((inline) => {
    if (inline.lineBreak) return new TextRun({ break: 1 });
    const run = new TextRun({
      text: inline.text,
      bold: inline.bold,
      italics: inline.italic,
      strike: inline.strike,
      font: inline.code ? "Consolas" : undefined,
      style: inline.href && isWebLink(inline.href) ? "Hyperlink" : undefined,
    });
    return inline.href && isWebLink(inline.href)
      ? new ExternalHyperlink({ link: inline.href, children: [run] })
      : run;
  });
}

function docxParagraph(block: Block): Paragraph {
  switch (block.kind) {
    case "heading":
      return new Paragraph({ heading: HEADING[block.level], children: docxRuns(block.inlines) });
    case "paragraph":
      return new Paragraph({ children: docxRuns(block.inlines), spacing: { after: 160 } });
    case "quote":
      return new Paragraph({
        children: docxRuns(block.inlines.map((inline) => ({ ...inline, italic: true }))),
        indent: { left: 567 },
        spacing: { after: 160 },
      });
    case "list_item": {
      const level = Math.min(block.depth, MAX_LIST_LEVEL);
      return new Paragraph({
        children: docxRuns(block.inlines),
        ...(block.ordered
          ? // One numbering instance per list, so every list starts again at 1.
            { numbering: { reference: ORDERED_LIST, level, instance: block.list } }
          : { bullet: { level } }),
      });
    }
    case "code":
      return new Paragraph({
        children: block.text
          .split("\n")
          .map(
            (line, index) => new TextRun({ text: line, font: "Consolas", break: index ? 1 : 0 }),
          ),
        spacing: { after: 160 },
      });
    case "rule":
      return new Paragraph({ thematicBreak: true });
    case "meta":
      return new Paragraph({
        children: [
          new TextRun({ text: `${block.label}: `, bold: true }),
          new TextRun({ text: block.value }),
        ],
        spacing: { after: 80 },
      });
  }
}

/** `.docx`: real Word headings (Heading 1–6 styles), lists, bold/italic and links. */
export function buildDocxDocument(input: ExportInput): Document {
  return new Document({
    creator: "Fanout AI",
    title: clean(input.title),
    numbering: {
      config: [
        {
          reference: ORDERED_LIST,
          levels: Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: toBlocks(input).map(docxParagraph) }],
  });
}

export async function buildDocx(input: ExportInput): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await Packer.toBuffer(buildDocxDocument(input));
  // A copy with its own ArrayBuffer: a Node Buffer may be a view into a shared pool.
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

const TRANSLITERATE: Record<string, string> = { đ: "dj", Đ: "Dj", ß: "ss", æ: "ae", ø: "o" };

/**
 * A safe, readable file name from the title: ASCII only (č → c, đ → dj), words
 * joined by hyphens, never empty. Nothing from the title can reach the
 * Content-Disposition header unescaped.
 */
export function exportFilename(title: string, format: ExportFormat): string {
  const slug = title
    .replace(/[đĐßæø]/g, (char) => TRANSLITERATE[char] ?? char)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "fanout-content"}.${format}`;
}
