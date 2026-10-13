import { formatFailure } from "./errors";
import { isUsableSecret, signedHeaders } from "./hmac";
import type { Delivery } from "./render";

/*
 * The dispatcher abstraction (spec §4.5, Phase 6.4).
 *
 *   N8nDispatcher        hands the message to an n8n workflow over a signed
 *                        webhook. n8n answers "accepted" and reports the real
 *                        outcome later through POST /api/publish/callback.
 *   SimulatedDispatcher  delivers nothing: waits a moment and reports success,
 *                        flagged `simulated`. Used whenever n8n is not
 *                        configured — which includes the public demo.
 *
 * Which one runs is decided by configuration alone (`N8N_BASE_URL` +
 * `N8N_SHARED_SECRET`), never by anything a user sends.
 */

export type DispatchRequest = { jobId: string; attemptId: string; delivery: Delivery };

export type DispatchResult =
  /** Handed over; the outcome arrives through the signed callback. */
  | { status: "accepted" }
  /** Finished here and now. `error` is a stored failure code (see errors.ts). */
  | { status: "done"; ok: boolean; error: string | null; simulated: boolean };

export interface Dispatcher {
  readonly mode: PublishMode;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
}

export type PublishMode = "n8n" | "simulated";

export type PublishConfig = {
  n8nBaseUrl: string | null;
  n8nSecret: string | null;
  cronSecret: string | null;
};

function baseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Kept without a trailing slash so paths can simply be appended.
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function getPublishConfig(env: NodeJS.ProcessEnv = process.env): PublishConfig {
  const n8nSecret = env.N8N_SHARED_SECRET?.trim();
  const cronSecret = env.CRON_SECRET?.trim();
  return {
    n8nBaseUrl: baseUrl(env.N8N_BASE_URL),
    n8nSecret: isUsableSecret(n8nSecret) ? n8nSecret : null,
    cronSecret: isUsableSecret(cronSecret) ? cronSecret : null,
  };
}

/** Real delivery needs both the address of n8n and the secret to sign with. */
export const publishMode = (config: PublishConfig = getPublishConfig()): PublishMode =>
  config.n8nBaseUrl && config.n8nSecret ? "n8n" : "simulated";

/** The body n8n receives. Versioned so a workflow can refuse a shape it does not know. */
export type N8nPayload = {
  version: 1;
  jobId: string;
  attemptId: string;
  kind: Delivery["kind"];
  email?: { to: string; subject: string; text: string };
  discord?: { webhookUrl: string; messages: string[] };
};

export const N8N_WEBHOOK_PATHS = {
  email: "/webhook/fanout-publish-email",
  discord: "/webhook/fanout-publish-discord",
} as const satisfies Record<Delivery["kind"], string>;

export function toN8nPayload({ jobId, attemptId, delivery }: DispatchRequest): N8nPayload {
  const base = { version: 1 as const, jobId, attemptId, kind: delivery.kind };
  return delivery.kind === "email"
    ? { ...base, email: { to: delivery.to, subject: delivery.subject, text: delivery.text } }
    : { ...base, discord: { webhookUrl: delivery.webhookUrl, messages: delivery.messages } };
}

type N8nOptions = {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

export class N8nDispatcher implements Dispatcher {
  readonly mode = "n8n";
  readonly #options: Required<N8nOptions>;

  constructor(options: N8nOptions) {
    this.#options = { fetch, now: Date.now, timeoutMs: 10_000, ...options };
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const { baseUrl: base, secret, fetch: send, now, timeoutMs } = this.#options;
    // Serialised once: the signature covers exactly the bytes that are sent.
    const body = JSON.stringify(toN8nPayload(request));

    let response: Response;
    try {
      response = await send(`${base}${N8N_WEBHOOK_PATHS[request.delivery.kind]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...signedHeaders(secret, body, now()) },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { status: "done", ok: false, error: "n8n_unreachable", simulated: false };
    }

    if (!response.ok) {
      return {
        status: "done",
        ok: false,
        error: formatFailure("n8n_rejected", response.status),
        simulated: false,
      };
    }
    return { status: "accepted" };
  }
}

type SimulatedOptions = { delayMs?: number; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SimulatedDispatcher implements Dispatcher {
  readonly mode = "simulated";
  readonly #delayMs: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor({ delayMs = 900, sleep = realSleep }: SimulatedOptions = {}) {
    this.#delayMs = delayMs;
    this.#sleep = sleep;
  }

  async dispatch(): Promise<DispatchResult> {
    // Long enough for "Sending…" to be seen, short enough for a cron tick.
    await this.#sleep(this.#delayMs);
    return { status: "done", ok: true, error: null, simulated: true };
  }
}

export function createDispatcher(config: PublishConfig = getPublishConfig()): Dispatcher {
  return config.n8nBaseUrl && config.n8nSecret
    ? new N8nDispatcher({ baseUrl: config.n8nBaseUrl, secret: config.n8nSecret })
    : new SimulatedDispatcher();
}
