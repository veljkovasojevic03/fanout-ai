import { z } from "zod";

/*
 * Publish destinations (spec §4.5).
 *
 *   email    always the account's own verified address — there is nothing to
 *            configure, which is what stops it from being a way to send mail
 *            to strangers;
 *   discord  a webhook URL the user pastes in. Whoever holds that URL can post
 *            to the channel, so it is treated as a secret: stored per user
 *            under RLS, shown masked, never logged.
 */

export const DESTINATION_KINDS = ["email", "discord"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export const DESTINATION_LIMITS = { labelMax: 60, maxDiscord: 5 } as const;

/**
 * The same pattern as the CHECK constraint on `publish_destinations.config`:
 * exactly `https://discord.com/api/webhooks/<id>/<token>` — no other host, no
 * port, no credentials, no query string. The app and the database must agree;
 * a unit test and a database test feed both the same bad URLs.
 */
export const DISCORD_WEBHOOK_PATTERN =
  /^https:\/\/discord\.com\/api\/webhooks\/[0-9]{5,30}\/[A-Za-z0-9_-]{20,200}$/;

export const isDiscordWebhookUrl = (value: unknown): value is string =>
  typeof value === "string" && DISCORD_WEBHOOK_PATTERN.test(value);

/**
 * Accepts the URL forms Discord itself hands out and returns the canonical
 * one, or null. `discordapp.com`, `canary.`/`ptb.` hosts and a trailing slash
 * or query string are common in copied URLs; everything else is refused.
 */
export function normalizeDiscordWebhookUrl(raw: string): string | null {
  const match =
    /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/([0-9]{5,30})\/([A-Za-z0-9_-]{20,200})\/?(?:\?[^#\s]*)?$/.exec(
      raw.trim(),
    );
  if (!match) return null;
  const url = `https://discord.com/api/webhooks/${match[1]}/${match[2]}`;
  return isDiscordWebhookUrl(url) ? url : null;
}

/** What the UI shows instead of the URL: enough to tell two webhooks apart, not enough to use. */
export function maskDiscordWebhookUrl(url: string): string {
  const match = /\/webhooks\/([0-9]+)\/([A-Za-z0-9_-]+)$/.exec(url);
  if (!match) return "••••";
  return `discord.com/…/${match[1]!.slice(-4)}/••••${match[2]!.slice(-4)}`;
}

export const discordDestinationSchema = z.object({
  label: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(DESTINATION_LIMITS.labelMax)),
  webhookUrl: z.string().max(400),
});

/** A destination as the UI sees it. `hint` is the masked URL; the URL itself stays on the server. */
export type DestinationView = {
  id: string;
  kind: DestinationKind;
  label: string;
  hint: string | null;
};

/** What a publish request names: the built-in email destination, or one of the user's own. */
export const destinationRefSchema = z.union([z.literal("email"), z.uuid()]);
export type DestinationRef = z.infer<typeof destinationRefSchema>;
