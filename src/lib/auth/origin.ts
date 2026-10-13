import "server-only";

import { headers } from "next/headers";

/**
 * The public origin of this app, used to build auth redirect URLs.
 *
 * NEXT_PUBLIC_APP_URL is authoritative. The request's Host header is only a
 * development fallback: it is attacker-controllable, so production should always
 * set the env var. (Supabase also rejects redirect URLs that are not on the
 * project's allow-list, which is the second line of defence.)
 */
export async function getAppOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Malformed value: fall through to the request-derived origin.
    }
  }

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol = headerList.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Absolute URL of the auth callback that will finish at `next` (a same-site path). */
export async function callbackUrl(next: string): Promise<string> {
  const url = new URL("/auth/callback", await getAppOrigin());
  url.searchParams.set("next", next);
  return url.toString();
}
