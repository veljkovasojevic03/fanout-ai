import type { AppLocale } from "@/i18n/config";
import { parseBlog, parseEmail } from "@/lib/content/contracts";
import { buildPlainText } from "@/lib/library/export";
import type { ContentType } from "@/lib/presets";

import type { DeliveryErrorCode } from "./errors";

/*
 * Turns a saved piece into what actually gets sent. Pure functions; the
 * dispatcher only transports the result.
 *
 * Nothing is ever cut to fit: a piece that is too long for a destination
 * fails with `content_too_long` and the user decides what to do.
 */

export type PublishContent = {
  type: ContentType;
  title: string;
  body: string;
  language: AppLocale;
};

export const DELIVERY_LIMITS = {
  subjectMax: 200,
  /** Discord's limit is 2000 characters per message; the margin covers how it counts. */
  discordMessageMax: 1900,
  /** More messages than this in one go is a flood, not a post. */
  discordMaxMessages: 10,
} as const;

export type EmailMessage = { subject: string; text: string };

/** One line, no control characters: a subject must not be able to add mail headers. */
const oneLine = (value: string) =>
  value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Plain-text email. An `email` piece carries its own `Subject:` line (the
 * content contract); every other format is sent under its title.
 */
export function renderEmail(content: PublishContent): EmailMessage | null {
  const email = content.type === "email" ? parseEmail(content.body) : null;
  const subject = oneLine(email?.subject ?? content.title).slice(0, DELIVERY_LIMITS.subjectMax);
  // The subject and preheader lines are headers, not part of the message text.
  const text = buildPlainText(email ? { ...content, body: email.body } : content).trim();
  if (subject === "" || text === "") return null;
  return { subject, text };
}

/** Splits text into chunks of at most `max` characters, at the best break available. */
export function splitMessage(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    // Prefer a paragraph break, then a line break, then a space; cut mid-word only if forced.
    let cut = window.lastIndexOf("\n\n");
    if (cut < max / 2) cut = Math.max(cut, window.lastIndexOf("\n"));
    if (cut < max / 2) cut = Math.max(cut, window.lastIndexOf(" "));
    if (cut <= 0) cut = max;
    // Never split a surrogate pair.
    if (cut === max && /[\uD800-\uDBFF]/.test(rest[cut - 1] ?? "")) cut -= 1;

    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== "") chunks.push(rest);
  return chunks;
}

/**
 * Discord messages. Discord renders Markdown itself, so the piece is sent as
 * written — minus a blog post's SEO front block, which is metadata.
 */
export function renderDiscord(content: PublishContent): string[] | null {
  const body = content.type === "blog" ? parseBlog(content.body).body : content.body;
  const messages = splitMessage(body.replace(/\r\n?/g, "\n"), DELIVERY_LIMITS.discordMessageMax);
  return messages.length === 0 ? null : messages;
}

export type Delivery =
  | { kind: "email"; to: string; subject: string; text: string }
  | { kind: "discord"; webhookUrl: string; messages: string[] };

export type DeliveryTarget =
  { kind: "email"; to: string | null } | { kind: "discord"; webhookUrl: string };

export type DeliveryResult =
  { ok: true; delivery: Delivery } | { ok: false; error: DeliveryErrorCode };

/** What to send where, or the reason this piece cannot be sent there. */
export function buildDelivery(content: PublishContent, target: DeliveryTarget): DeliveryResult {
  if (target.kind === "email") {
    if (!target.to) return { ok: false, error: "email_unverified" };
    const message = renderEmail(content);
    if (!message) return { ok: false, error: "content_empty" };
    return { ok: true, delivery: { kind: "email", to: target.to, ...message } };
  }

  const messages = renderDiscord(content);
  if (!messages) return { ok: false, error: "content_empty" };
  if (messages.length > DELIVERY_LIMITS.discordMaxMessages) {
    return { ok: false, error: "content_too_long" };
  }
  return { ok: true, delivery: { kind: "discord", webhookUrl: target.webhookUrl, messages } };
}
