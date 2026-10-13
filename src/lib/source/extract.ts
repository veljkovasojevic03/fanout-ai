import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const SOURCE_TEXT_MAX = 8000;

/** Collapses runs of whitespace but keeps paragraph breaks. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts at `max` characters, on a word boundary when one is close. */
export function truncateText(text: string, max: number = SOURCE_TEXT_MAX): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join("");
  const lastSpace = cut.lastIndexOf(" ");
  // Back up to the last space unless that would throw away a large chunk
  // (e.g. one very long unbroken string).
  const nearEnd = lastSpace >= cut.length - Math.max(40, max * 0.1);
  return (lastSpace > 0 && nearEnd ? cut.slice(0, lastSpace) : cut).trimEnd();
}

const NOISE = "script, style, noscript, template, iframe, svg, nav, header, footer, aside, form";

/**
 * Pulls the readable article text out of an HTML page (Readability, on linkedom —
 * no full browser DOM, which matters on serverless). Falls back to the page's
 * visible body text when Readability finds no article.
 *
 * The result is plain text. It is still untrusted and is only ever handed to the
 * model inside a <source> block.
 */
export function extractReadableText(html: string): { title: string | null; text: string } {
  if (html.trim() === "") return { title: null, text: "" };

  try {
    return extract(html);
  } catch {
    // A page the parser cannot handle is treated as having no readable text,
    // which the caller reports as an empty source. Never a crash.
    return { title: null, text: "" };
  }
}

function extract(html: string): { title: string | null; text: string } {
  const { document } = parseHTML(html);
  const pageTitle = document.querySelector("title")?.textContent?.trim() || null;

  let article: { title?: string | null; textContent?: string | null } | null = null;
  try {
    // Readability mutates the document it is given, so it gets its own copy.
    article = new Readability(parseHTML(html).document as unknown as Document).parse();
  } catch {
    article = null;
  }

  const articleText = normaliseText(article?.textContent ?? "");
  if (articleText.length >= 200) {
    return { title: article?.title?.trim() || pageTitle, text: articleText };
  }

  for (const element of document.querySelectorAll(NOISE)) element.remove();
  const bodyText = normaliseText(document.body?.textContent ?? "");
  return { title: pageTitle, text: bodyText.length > articleText.length ? bodyText : articleText };
}
