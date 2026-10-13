"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import type { ContractWarning } from "@/lib/content/contracts";
import { toGenerateErrorCode, type GenerateErrorCode } from "@/lib/generation/errors";
import { streamDoneSchema, streamMetaSchema, type StreamMeta } from "@/lib/generation/schema";
import { readSseStream } from "@/lib/generation/sse";
import type { GenerationMode } from "@/lib/generation/types";

export type StreamStatus = "connecting" | "streaming" | "done" | "stopped" | "error";

export type StreamState = {
  status: StreamStatus;
  text: string;
  mode: GenerationMode | null;
  model: string | null;
  error: GenerateErrorCode | null;
  /** Contract violations reported by the server once the piece is complete. */
  warnings: ContractWarning[];
};

/** Builds the request for one stream. The demo and the real generator differ only here. */
export type StreamRequestFactory = (options: { regenerate: boolean; attempt: number }) => {
  url: string;
  body: unknown;
};

type Action =
  | { type: "connecting" }
  | { type: "meta"; meta: StreamMeta }
  | { type: "append"; text: string }
  | { type: "done"; warnings: ContractWarning[] }
  | { type: "stopped" }
  | { type: "error"; code: GenerateErrorCode };

const INITIAL: StreamState = {
  status: "connecting",
  text: "",
  mode: null,
  model: null,
  error: null,
  warnings: [],
};

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case "connecting":
      // The previous text stays on screen until the new stream actually starts.
      return { ...state, status: "connecting", error: null };
    case "meta":
      return {
        ...state,
        status: "streaming",
        text: "",
        warnings: [],
        mode: action.meta.mode,
        model: action.meta.model,
      };
    case "append":
      return { ...state, text: state.text + action.text };
    case "done":
      return { ...state, status: "done", warnings: action.warnings };
    case "stopped":
      return { ...state, status: "stopped" };
    case "error":
      return { ...state, status: "error", error: action.code };
  }
}

async function errorCodeOf(response: Response): Promise<GenerateErrorCode> {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: { code?: unknown } })?.error?.code;
    return toGenerateErrorCode(code, "server_error");
  } catch {
    return "server_error";
  }
}

const parseJson = (data: string): unknown => {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

type Options = {
  request: StreamRequestFactory;
  /** Called when a stream starts, with the server's view of mode and regenerations left. */
  onMeta?(meta: StreamMeta): void;
};

/**
 * One streaming piece of content (spec §5.7): `fetch` + ReadableStream, parsed
 * as SSE, cancellable with an AbortController. Starts on mount.
 *
 * Failure handling:
 *  - an HTTP error before the stream starts → `error` with the server's code;
 *  - an `error` event, or a connection that ends without `done` → `error`, and
 *    the text received so far is kept;
 *  - `stop()` → `stopped`, text kept.
 *
 * The first stream of a piece is allowed once; later ones go through the capped
 * regenerate path. If the two get out of step (e.g. the first request reached
 * the server but its response was lost), the hook switches path once by itself.
 */
export function useContentStream({ request, onMeta }: Options) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const controllerRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);
  const bufferRef = useRef("");
  const frameRef = useRef<number | null>(null);
  // Latest callbacks, so `run` itself never has to change identity.
  const requestRef = useRef(request);
  const onMetaRef = useRef(onMeta);
  useEffect(() => {
    requestRef.current = request;
    onMetaRef.current = onMeta;
  });

  /** Deltas are batched per animation frame: five parallel streams must not re-render per token. */
  const flush = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (bufferRef.current) {
      const text = bufferRef.current;
      bufferRef.current = "";
      dispatch({ type: "append", text });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const run = useCallback(
    async (regenerate: boolean, options: { announce: boolean; allowSwitch: boolean }) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const isCurrent = () => controllerRef.current === controller;

      bufferRef.current = "";
      if (options.announce) dispatch({ type: "connecting" });

      attemptRef.current += 1;
      let finished = false;

      try {
        const open = (viaRegenerate: boolean) => {
          const { url, body } = requestRef.current({
            regenerate: viaRegenerate,
            attempt: attemptRef.current,
          });
          return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        };

        let response = await open(regenerate);

        if (!response.ok && options.allowSwitch) {
          // The two paths can get out of step (e.g. the first request reached the
          // server but its response was lost). Switch path once, then give up.
          const code = await errorCodeOf(response.clone());
          if (code === "already_streamed" && !regenerate) response = await open(true);
          else if (code === "not_started" && regenerate) response = await open(false);
        }

        if (!response.ok || !response.body) {
          const code = await errorCodeOf(response);
          if (isCurrent()) dispatch({ type: "error", code });
          return;
        }

        for await (const event of readSseStream(response.body)) {
          if (!isCurrent()) return;

          if (event.event === "delta") {
            const text = (parseJson(event.data) as { text?: unknown } | null)?.text;
            if (typeof text === "string") {
              bufferRef.current += text;
              scheduleFlush();
            }
          } else if (event.event === "meta") {
            const meta = streamMetaSchema.safeParse(parseJson(event.data));
            if (meta.success) {
              bufferRef.current = "";
              dispatch({ type: "meta", meta: meta.data });
              onMetaRef.current?.(meta.data);
            }
          } else if (event.event === "done") {
            const done = streamDoneSchema.safeParse(parseJson(event.data));
            flush();
            dispatch({
              type: "done",
              warnings: done.success ? (done.data.warnings as ContractWarning[]) : [],
            });
            finished = true;
          } else if (event.event === "error") {
            const code = (parseJson(event.data) as { code?: unknown } | null)?.code;
            flush();
            dispatch({ type: "error", code: toGenerateErrorCode(code, "stream_failed") });
            finished = true;
          }
        }

        // The server closed the stream without saying how it ended.
        if (!finished && isCurrent()) {
          flush();
          dispatch({ type: "error", code: "network_error" });
        }
      } catch {
        if (!isCurrent()) return;
        flush();
        dispatch(
          controller.signal.aborted
            ? { type: "stopped" }
            : { type: "error", code: "network_error" },
        );
      }
    },
    [flush, scheduleFlush],
  );

  useEffect(() => {
    // Deferred by a tick so React's development double-mount cancels the first
    // attempt before it reaches the server (which would use up the one allowed stream).
    const timer = window.setTimeout(() => {
      void run(false, { announce: false, allowSwitch: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
      controllerRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [run]);

  const stop = useCallback(() => controllerRef.current?.abort(), []);
  const regenerate = useCallback(
    () => void run(true, { announce: true, allowSwitch: true }),
    [run],
  );

  return { state, stop, regenerate };
}
