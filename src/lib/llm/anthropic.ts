import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { StreamError, type ContentSource, type StreamChunk } from "@/lib/generation/types";

import { isAbort, mapLlmError } from "./errors";
import { buildPrompt, maxOutputTokens } from "./prompts";

// One client per server instance. It reads ANTHROPIC_API_KEY from the environment.
let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: 50_000 }));

/**
 * Per-model request options. Haiku 4.5 does not think unless asked and rejects
 * `effort`. Newer models think adaptively and count that thinking against
 * `max_tokens`, so they get low effort (this is short-form writing, not
 * reasoning) and extra token headroom so the piece itself is never cut off.
 */
export function modelOptions(model: string): {
  extraTokens: number;
  params: Pick<Anthropic.MessageStreamParams, "output_config">;
} {
  if (/haiku-4-5/.test(model)) return { extraTokens: 0, params: {} };
  return { extraTokens: 2000, params: { output_config: { effort: "low" } } };
}

/**
 * Live mode: streams one piece from Claude. Yields text deltas as they arrive
 * and, at the end, the token usage reported by the final message.
 */
export function createLiveSource(model: string): ContentSource {
  return async function* liveSource({ brief, type, signal }): AsyncGenerator<StreamChunk> {
    const prompt = buildPrompt(brief, type);
    const options = modelOptions(model);

    try {
      const stream = getClient().messages.stream(
        {
          model,
          max_tokens: maxOutputTokens(type, brief.length, brief.language) + options.extraTokens,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          ...options.params,
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }

      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") throw new StreamError("llm_refused");

      yield {
        type: "usage",
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    } catch (error) {
      // A deliberate cancel is not a failure: let the caller see it as an abort.
      if (isAbort(error, signal)) throw error;
      throw new StreamError(mapLlmError(error), { cause: error });
    }
  };
}
