export const DEFAULT_AFTER_AUTH = "/app";

const BASE = "http://internal.invalid";

/**
 * Sanitises a user-supplied "next" destination so it can only ever point at a
 * path on this site. Anything else — absolute URLs, protocol-relative `//host`,
 * backslash tricks, control characters — falls back to a safe default.
 * Prevents open redirects through `?next=`.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_AFTER_AUTH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" and strip tabs/newlines, so "/\evil.com" must not pass.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;

  return url.pathname + url.search;
}
