import "server-only";

import { lookup } from "node:dns/promises";
import https from "node:https";
import type { LookupFunction } from "node:net";

import type { ResolvedAddress, SourceDeps } from "./fetch-url";

/*
 * The real network side of the URL source fetcher. Kept tiny on purpose: every
 * policy decision lives in fetch-url.ts (and is unit-tested there); this file
 * only resolves names and opens one pinned HTTPS connection.
 */

const resolve: SourceDeps["resolve"] = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};

/**
 * A DNS `lookup` replacement that always answers with the one address we
 * already vetted. This is what closes the DNS-rebinding window: Node cannot
 * resolve the hostname a second time to something else.
 */
function pinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
    } else {
      callback(null, pinned.address, pinned.family);
    }
  };
}

const transport: SourceDeps["transport"] = ({ url, address, signal }) =>
  new Promise((resolvePromise, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        // TLS still verifies the certificate against the hostname (SNI + Host
        // come from `url`); only the IP we connect to is fixed.
        lookup: pinnedLookup(address),
        agent: false,
        signal,
        headers: {
          "User-Agent": "FanoutAI-SourceFetcher/1.0",
          Accept: "text/html, text/plain;q=0.9",
          // No compression: a small gzip body must not be able to inflate past the size cap.
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        }
        resolvePromise({
          status: response.statusCode ?? 0,
          headers,
          body: response,
          close: () => request.destroy(),
        });
      },
    );

    request.on("error", reject);
    request.end();
  });

export const nodeSourceDeps: SourceDeps = { resolve, transport };
