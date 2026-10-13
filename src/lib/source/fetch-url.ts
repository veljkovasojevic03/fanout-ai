import { extractReadableText, normaliseText, truncateText } from "./extract";
import { isIpLiteral, isPublicAddress } from "./ip";

/*
 * Fetches a user-supplied URL for the "repurpose" source (spec §5.8).
 *
 * A URL chosen by a user and fetched by our server is a classic SSRF vector:
 * it could point at cloud metadata, localhost, or a private network. Defences,
 * all enforced here:
 *
 *   - https only, default port only, no credentials in the URL;
 *   - the hostname is resolved first and EVERY address it resolves to must be
 *     public — one private address rejects the whole request;
 *   - the connection is then made to exactly the address that was checked
 *     (the transport is pinned), so a DNS answer cannot change between check
 *     and use (DNS rebinding);
 *   - redirects are followed manually, at most 3, and each hop goes through the
 *     same checks again;
 *   - one 8 s deadline covers the whole operation, redirects included;
 *   - the body is capped at 1 MB while streaming (Content-Length is not trusted);
 *   - only text/html and text/plain are accepted.
 *
 * Network access is injected (`resolve`, `transport`) so every rule is unit-tested
 * without touching the network.
 */

export const SOURCE_LIMITS = {
  maxRedirects: 3,
  timeoutMs: 8000,
  maxBytes: 1024 * 1024,
  maxUrlLength: 2048,
} as const;

export const SOURCE_ERROR_CODES = [
  "source_invalid_url",
  "source_blocked",
  "source_unreachable",
  "source_timeout",
  "source_too_many_redirects",
  "source_http_error",
  "source_unsupported_type",
  "source_too_large",
  "source_empty",
] as const;
export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

export class SourceFetchError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "SourceFetchError";
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type TransportResponse = {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Releases the connection without reading the rest of the body. */
  close(): void;
};

export type SourceDeps = {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
  /** Must connect to `address` (not re-resolve `url.hostname`) and must NOT follow redirects. */
  transport(request: {
    url: URL;
    address: ResolvedAddress;
    signal: AbortSignal;
  }): Promise<TransportResponse>;
};

export type FetchedSource = { url: string; title: string | null; text: string };

/** Syntax and policy checks that need no network. Throws SourceFetchError. */
export function parseSourceUrl(raw: string, base?: URL): URL {
  if (raw.length > SOURCE_LIMITS.maxUrlLength) throw new SourceFetchError("source_invalid_url");

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch (error) {
    throw new SourceFetchError("source_invalid_url", { cause: error });
  }

  if (url.protocol !== "https:") throw new SourceFetchError("source_blocked");
  if (url.username || url.password) throw new SourceFetchError("source_blocked");
  if (url.port !== "" && url.port !== "443") throw new SourceFetchError("source_blocked");
  if (!url.hostname) throw new SourceFetchError("source_invalid_url");

  return url;
}

/** Resolves the host and returns an address to connect to, or throws if any is not public. */
async function vetHost(url: URL, deps: SourceDeps): Promise<ResolvedAddress> {
  // URL.hostname keeps the brackets around an IPv6 literal.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIpLiteral(hostname)) {
    if (!isPublicAddress(hostname)) throw new SourceFetchError("source_blocked");
    return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await deps.resolve(hostname);
  } catch (error) {
    throw new SourceFetchError("source_unreachable", { cause: error });
  }

  if (addresses.length === 0) throw new SourceFetchError("source_unreachable");
  // All of them, not just the first: a host that also answers with a private
  // address is not one we talk to.
  if (!addresses.every(({ address }) => isPublicAddress(address))) {
    throw new SourceFetchError("source_blocked");
  }

  return addresses[0]!;
}

const mediaType = (header: string | undefined) =>
  (header ?? "").split(";")[0]!.trim().toLowerCase();

const charsetOf = (header: string | undefined) =>
  /charset\s*=\s*"?([^";\s]+)"?/i.exec(header ?? "")?.[1] ?? "utf-8";

function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(bytes);
  } catch {
    // Unknown charset label: UTF-8 with replacement characters is good enough for reference text.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(body: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > limit) throw new SourceFetchError("source_too_large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches `rawUrl` under all the rules above and returns its readable text,
 * truncated to 8000 characters. Throws SourceFetchError with a stable code.
 */
export async function fetchSource(rawUrl: string, deps: SourceDeps): Promise<FetchedSource> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SOURCE_LIMITS.timeoutMs);

  try {
    let url = parseSourceUrl(rawUrl.trim());

    for (let hop = 0; ; hop += 1) {
      const address = await vetHost(url, deps);

      let response: TransportResponse;
      try {
        response = await deps.transport({ url, address, signal: deadline.signal });
      } catch (error) {
        if (deadline.signal.aborted) throw new SourceFetchError("source_timeout", { cause: error });
        if (error instanceof SourceFetchError) throw error;
        throw new SourceFetchError("source_unreachable", { cause: error });
      }

      if (response.status >= 300 && response.status < 400) {
        response.close();
        const location = response.headers.location;
        if (!location) throw new SourceFetchError("source_http_error");
        if (hop >= SOURCE_LIMITS.maxRedirects) {
          throw new SourceFetchError("source_too_many_redirects");
        }
        // The redirect target is as untrusted as the original URL: full re-check.
        url = parseSourceUrl(location, url);
        continue;
      }

      try {
        if (response.status < 200 || response.status >= 300) {
          throw new SourceFetchError("source_http_error");
        }

        const type = mediaType(response.headers["content-type"]);
        if (type !== "text/html" && type !== "text/plain") {
          throw new SourceFetchError("source_unsupported_type");
        }

        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > SOURCE_LIMITS.maxBytes) {
          throw new SourceFetchError("source_too_large");
        }

        let bytes: Uint8Array;
        try {
          bytes = await readCapped(response.body, SOURCE_LIMITS.maxBytes);
        } catch (error) {
          if (error instanceof SourceFetchError) throw error;
          if (deadline.signal.aborted) {
            throw new SourceFetchError("source_timeout", { cause: error });
          }
          throw new SourceFetchError("source_unreachable", { cause: error });
        }

        const raw = decodeBody(bytes, response.headers["content-type"]);
        const extracted =
          type === "text/html"
            ? extractReadableText(raw)
            : { title: null, text: normaliseText(raw) };

        const text = truncateText(extracted.text);
        if (text.length === 0) throw new SourceFetchError("source_empty");

        return { url: url.toString(), title: extracted.title, text };
      } finally {
        response.close();
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
