import { handleStreamRequest } from "@/lib/generation/stream-route";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Re-streams one piece. Free, but capped at 10 per generation and rate limited. */
export function POST(request: Request) {
  return handleStreamRequest(request, { regenerate: true });
}
