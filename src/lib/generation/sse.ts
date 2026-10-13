/*
 * Server-Sent Events, both directions.
 *
 * The server writes events with `encodeSseEvent`; the browser reads them from a
 * `fetch` response body with `SseParser` / `readSseStream`. We use fetch rather
 * than EventSource because the request is a POST with a JSON body and must be
 * cancellable with an AbortController (spec §5.7).
 */

export type SseEvent = { event: string; data: string };

/** One SSE frame. Newlines in `data` become multiple `data:` lines, per the spec. */
export function encodeSseEvent(event: string, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload.split(/\r\n|\r|\n/).map((line) => `data: ${line}`);
  return `event: ${event}\n${lines.join("\n")}\n\n`;
}

/**
 * Incremental SSE parser. Feed it text in arbitrary chunks — network chunks do
 * not line up with event boundaries — and it returns the events completed so far.
 */
export class SseParser {
  private buffer = "";
  private event = "";
  private data: string[] = [];

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    let newline: number;
    while ((newline = this.nextLineBreak()) !== -1) {
      const breakLength = this.buffer.startsWith("\r\n", newline) ? 2 : 1;
      // A lone "\r" at the very end may be the first half of "\r\n": wait for more.
      if (this.buffer[newline] === "\r" && newline === this.buffer.length - 1) break;

      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + breakLength);

      if (line === "") {
        const dispatched = this.dispatch();
        if (dispatched) events.push(dispatched);
      } else {
        this.readLine(line);
      }
    }

    return events;
  }

  private nextLineBreak(): number {
    const lf = this.buffer.indexOf("\n");
    const cr = this.buffer.indexOf("\r");
    if (lf === -1) return cr;
    if (cr === -1) return lf;
    return Math.min(lf, cr);
  }

  private readLine(line: string): void {
    if (line.startsWith(":")) return; // comment / keep-alive

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    // "id" and "retry" are not used by this protocol.
  }

  private dispatch(): SseEvent | null {
    if (this.data.length === 0) {
      this.event = "";
      return null;
    }
    const event = { event: this.event || "message", data: this.data.join("\n") };
    this.event = "";
    this.data = [];
    return event;
  }
}

/** Reads a fetch response body as SSE events. Decodes UTF-8 across chunk boundaries. */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new SseParser();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.feed(decoder.decode(value, { stream: true }));
    }
    yield* parser.feed(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
