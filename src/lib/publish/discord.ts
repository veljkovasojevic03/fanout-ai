import { isDiscordWebhookUrl } from "./destinations";

/*
 * "Send test message" (spec Phase 6.1). A test has no job for n8n's callback
 * to report to, so the app posts it to Discord itself — but only on a
 * deployment where publishing is real (see actions.ts); the public demo never
 * makes a request on a visitor's behalf.
 *
 * The URL is re-checked against the strict pattern right before the request
 * and redirects are refused, so this cannot be pointed at anything but
 * discord.com.
 */

export type DiscordTestResult = { ok: true } | { ok: false; httpStatus: number | null };

export async function sendDiscordMessage(
  webhookUrl: string,
  content: string,
  send: typeof fetch = fetch,
): Promise<DiscordTestResult> {
  if (!isDiscordWebhookUrl(webhookUrl)) return { ok: false, httpStatus: null };

  try {
    const response = await send(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No mention in the text can ping anyone.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? { ok: true } : { ok: false, httpStatus: response.status };
  } catch {
    return { ok: false, httpStatus: null };
  }
}
