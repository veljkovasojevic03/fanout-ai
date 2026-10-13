import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/*
 * Request signing between the app and n8n, both directions (spec §5.9):
 *
 *   X-Timestamp: <unix seconds>
 *   X-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">
 *
 * The timestamp is inside the signed string, so it cannot be changed to make
 * an old request look fresh; a request older (or newer) than five minutes is
 * refused even when its signature is right. Comparisons are constant-time.
 *
 * Pure functions — the same code signs outgoing requests and verifies
 * incoming ones, and the n8n workflows are tested against it.
 */

export const TIMESTAMP_HEADER = "X-Timestamp";
export const SIGNATURE_HEADER = "X-Signature";
export const REPLAY_WINDOW_SECONDS = 300;

/** Anything shorter is treated as "not configured": a guessable secret signs nothing. */
export const MIN_SECRET_LENGTH = 16;

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export const isUsableSecret = (secret: string | null | undefined): secret is string =>
  typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;

/** The value of the X-Signature header for this timestamp and body. */
export function signPayload(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  return `sha256=${digest}`;
}

/** Both headers for an outgoing request with this exact body. */
export function signedHeaders(secret: string, body: string, now: number = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signPayload(secret, timestamp, body),
  };
}

export type SignatureFailure = "missing" | "malformed" | "stale" | "mismatch";
export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

type VerifyInput = {
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  /** The raw request body, exactly as received. */
  body: string;
  now?: number;
  windowSeconds?: number;
};

export function verifySignature({
  secret,
  timestamp,
  signature,
  body,
  now = Date.now(),
  windowSeconds = REPLAY_WINDOW_SECONDS,
}: VerifyInput): SignatureCheck {
  if (!timestamp || !signature) return { ok: false, reason: "missing" };

  const given = SIGNATURE_PATTERN.exec(signature.trim());
  if (!given || !TIMESTAMP_PATTERN.test(timestamp)) return { ok: false, reason: "malformed" };

  // Compared before the age check, so an attacker learns nothing about the
  // window from a request they could not have signed anyway.
  const expected = SIGNATURE_PATTERN.exec(signPayload(secret, timestamp, body))![1]!;
  const match = timingSafeEqual(Buffer.from(given[1]!, "hex"), Buffer.from(expected, "hex"));
  if (!match) return { ok: false, reason: "mismatch" };

  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (age > windowSeconds) return { ok: false, reason: "stale" };

  return { ok: true };
}

/**
 * `Authorization: Bearer <secret>` for the cron endpoint. Both sides are
 * hashed first, so the comparison is constant-time and does not leak the
 * secret's length.
 */
export function verifyBearer(header: string | null | undefined, secret: string): boolean {
  const token = /^Bearer[ ]+(\S+)$/.exec(header?.trim() ?? "")?.[1];
  if (!token) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(token), digest(secret));
}
