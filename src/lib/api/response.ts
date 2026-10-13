import { NextResponse } from "next/server";

/**
 * The one error shape every API route returns (spec §5.5):
 *   { "error": { "code": "…", "message": "…" } }
 *
 * `code` is stable and is what the client translates. `message` is a short
 * English fallback for logs and non-UI consumers. Never put raw exception
 * text or stack traces in either.
 */
export type ApiErrorBody = { error: { code: string; message: string } };

export function apiError(code: string, message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status, headers });
}

export function apiOk<T>(data: T, headers?: HeadersInit) {
  return NextResponse.json<T>(data, { status: 200, headers });
}
