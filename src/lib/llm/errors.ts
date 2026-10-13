import Anthropic from "@anthropic-ai/sdk";

import { StreamError, type StreamErrorCode } from "@/lib/generation/types";

/**
 * Maps an Anthropic SDK failure to one of our stable stream error codes.
 * The SDK's own message never reaches the user — only the code does.
 * Most specific classes first; the order matters.
 */
export function mapLlmError(error: unknown): StreamErrorCode {
  if (error instanceof StreamError) return error.code;

  if (error instanceof Anthropic.RateLimitError) return "llm_rate_limited";
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError
  ) {
    // Bad key, no access to the model, unknown model id, or a request the API
    // rejects: retrying will not help, the deployment needs fixing.
    return "llm_misconfigured";
  }
  if (error instanceof Anthropic.APIConnectionError) return "llm_unavailable";
  if (error instanceof Anthropic.APIError) {
    if (error.status === 529) return "llm_overloaded";
    if ((error.status ?? 0) >= 500) return "llm_unavailable";
  }
  return "stream_failed";
}

/** True when the request was cancelled on purpose (user pressed Stop, tab closed). */
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof Anthropic.APIUserAbortError) return true;
  return error instanceof Error && error.name === "AbortError";
}
