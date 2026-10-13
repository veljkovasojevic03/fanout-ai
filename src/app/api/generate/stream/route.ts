import { handleStreamRequest } from "@/lib/generation/stream-route";

// Vercel Hobby allows longer, but every stream is designed to finish well inside
// a minute: capped max_tokens for live output, and the longest sample fixture
// streams in under 30 s (asserted by a unit test).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** First stream of one (generation, type). Allowed exactly once. */
export function POST(request: Request) {
  return handleStreamRequest(request, { regenerate: false });
}
