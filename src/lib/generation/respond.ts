import "server-only";

import { contentStats, validateContent } from "@/lib/content/contracts";
import { isAbort, mapLlmError } from "@/lib/llm/errors";
import { log } from "@/lib/log";
import type { ContentType, Length } from "@/lib/presets";

import type { StreamDone, StreamMeta } from "./schema";
import { encodeSseEvent } from "./sse";
import type { ContentStream, StreamErrorCode } from "./types";

export type StreamOutcome = {
  words: number;
  inputTokens: number;
  outputTokens: number;
  /** The client went away or pressed Stop. */
  aborted: boolean;
  failed: StreamErrorCode | null;
};

type StreamResponseOptions = {
  type: ContentType;
  meta: StreamMeta;
  /**
   * Requested length, for the blog word-target check. Leave undefined for
   * sample output, whose fixtures have one fixed length.
   */
  validateLength?: Length;
  /** Opens the content stream; must stop when `signal` aborts. */
  open(signal: AbortSignal): ContentStream;
  /** Aborts when the HTTP request is cancelled. */
  requestSignal: AbortSignal;
  /** Bookkeeping after the stream ends, however it ends. */
  onFinish?(outcome: StreamOutcome): Promise<void>;
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform stops proxies from buffering or compressing the stream.
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Turns a content stream into the SSE response of spec §5.7:
 *
 *   meta   once, first       { mode, model, attempt, regenerationsLeft }
 *   delta  per text chunk    { text }
 *   done   on success        { words, chars, warnings, inputTokens, outputTokens }
 *   error  on failure        { code }
 *
 * Sample and live streams go through this same function, which is what makes
 * them indistinguishable on the wire apart from `meta.mode`.
 */
export function createStreamResponse(options: StreamResponseOptions): Response {
  const { type, meta, open, requestSignal, onFinish, validateLength } = options;
  const encoder = new TextEncoder();
  const abort = new AbortController();

  if (requestSignal.aborted) abort.abort();
  else requestSignal.addEventListener("abort", () => abort.abort(), { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        } catch {
          // The client has gone; there is nobody left to write to.
          abort.abort();
        }
      };

      let text = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let failed: StreamErrorCode | null = null;

      send("meta", meta);

      try {
        for await (const chunk of open(abort.signal)) {
          if (abort.signal.aborted) break;
          if (chunk.type === "delta") {
            text += chunk.text;
            send("delta", { text: chunk.text });
          } else {
            inputTokens = chunk.inputTokens;
            outputTokens = chunk.outputTokens;
          }
        }
      } catch (error) {
        if (!isAbort(error, abort.signal)) {
          failed = mapLlmError(error);
          log.error("generation.stream_failed", {
            type,
            code: failed,
            mode: meta.mode,
            cause: error instanceof Error && error.cause instanceof Error ? error.cause.name : null,
          });
        }
      }

      const aborted = abort.signal.aborted;
      const stats = contentStats(type, text);

      if (failed) {
        send("error", { code: failed });
      } else if (!aborted) {
        const done: StreamDone = {
          words: stats.words,
          chars: stats.chars,
          warnings: validateContent(type, text, { length: validateLength }),
          inputTokens,
          outputTokens,
        };
        send("done", done);
      }

      try {
        await onFinish?.({ words: stats.words, inputTokens, outputTokens, aborted, failed });
      } catch (error) {
        log.error("generation.finish_failed", {
          type,
          name: error instanceof Error ? error.name : "unknown",
        });
      }

      try {
        controller.close();
      } catch {
        // Already closed by a cancel.
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, { status: 200, headers: SSE_HEADERS });
}
