import { describe, expect, it } from "vitest";

import { encodeSseEvent, readSseStream, SseParser, type SseEvent } from "./sse";

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const collect = async (body: ReadableStream<Uint8Array>) => {
  const events: SseEvent[] = [];
  for await (const event of readSseStream(body)) events.push(event);
  return events;
};

describe("encodeSseEvent", () => {
  it("writes an event name, JSON data and a blank line", () => {
    expect(encodeSseEvent("delta", { text: "Hi" })).toBe('event: delta\ndata: {"text":"Hi"}\n\n');
  });

  it("keeps newlines inside JSON strings escaped, so a frame is never split", () => {
    const frame = encodeSseEvent("delta", { text: "line one\n\nline two" });
    expect(frame.match(/\n\n/g)).toHaveLength(1);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("splits raw multi-line data across data: lines", () => {
    expect(encodeSseEvent("note", "a\nb")).toBe("event: note\ndata: a\ndata: b\n\n");
  });
});

describe("SseParser", () => {
  it("parses complete events", () => {
    const parser = new SseParser();
    const events = parser.feed(
      'event: meta\ndata: {"mode":"sample"}\n\nevent: delta\ndata: {"text":"Hi"}\n\n',
    );
    expect(events).toEqual([
      { event: "meta", data: '{"mode":"sample"}' },
      { event: "delta", data: '{"text":"Hi"}' },
    ]);
  });

  it("handles an event split at every possible byte boundary", () => {
    const frame = encodeSseEvent("delta", { text: "Zdravo, šta ima? 🧵" });
    for (let cut = 1; cut < frame.length; cut += 1) {
      const parser = new SseParser();
      const events = [...parser.feed(frame.slice(0, cut)), ...parser.feed(frame.slice(cut))];
      expect(events, `cut at ${cut}`).toEqual([
        { event: "delta", data: '{"text":"Zdravo, šta ima? 🧵"}' },
      ]);
    }
  });

  it("emits nothing until the blank line arrives", () => {
    const parser = new SseParser();
    expect(parser.feed('event: delta\ndata: {"text":"Hi"}\n')).toEqual([]);
    expect(parser.feed("\n")).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
  });

  it("joins multiple data lines with newlines", () => {
    expect(new SseParser().feed("data: a\ndata: b\n\n")).toEqual([
      { event: "message", data: "a\nb" },
    ]);
  });

  it("accepts CRLF and bare CR line endings, even split across chunks", () => {
    const parser = new SseParser();
    const events = [
      ...parser.feed("event: delta\r\ndata: one\r"),
      ...parser.feed("\n\r\nevent: delta\rdata: two\r\r"),
      ...parser.feed("x"),
    ];
    expect(events).toEqual([
      { event: "delta", data: "one" },
      { event: "delta", data: "two" },
    ]);
  });

  it("ignores comments, unknown fields and events without data", () => {
    const parser = new SseParser();
    expect(
      parser.feed(": keep-alive\n\nevent: empty\n\nid: 7\nretry: 100\nevent: done\ndata: {}\n\n"),
    ).toEqual([{ event: "done", data: "{}" }]);
  });

  it("strips only one leading space from a value", () => {
    expect(new SseParser().feed("data:  two spaces\n\n")).toEqual([
      { event: "message", data: " two spaces" },
    ]);
  });

  it("does not let one event's name leak into the next", () => {
    expect(new SseParser().feed("event: error\ndata: a\n\ndata: b\n\n")).toEqual([
      { event: "error", data: "a" },
      { event: "message", data: "b" },
    ]);
  });
});

describe("readSseStream", () => {
  it("round-trips encoded events through a byte stream", async () => {
    const encoder = new TextEncoder();
    const body = streamOf([
      encoder.encode(encodeSseEvent("meta", { mode: "live" })),
      encoder.encode(encodeSseEvent("delta", { text: "Hello " })),
      encoder.encode(encodeSseEvent("delta", { text: "world" })),
      encoder.encode(encodeSseEvent("done", { words: 2 })),
    ]);
    const events = await collect(body);
    expect(events.map((e) => e.event)).toEqual(["meta", "delta", "delta", "done"]);
    expect(JSON.parse(events[2]!.data)).toEqual({ text: "world" });
  });

  it("decodes multi-byte characters split across network chunks", async () => {
    const bytes = new TextEncoder().encode(encodeSseEvent("delta", { text: "čćžšđ 🧵" }));
    // One byte per chunk: every multi-byte character is split.
    const body = streamOf(Array.from(bytes, (byte) => new Uint8Array([byte])));
    const events = await collect(body);
    expect(JSON.parse(events[0]!.data)).toEqual({ text: "čćžšđ 🧵" });
  });

  it("drops a trailing partial event when the connection is cut mid-frame", async () => {
    const encoder = new TextEncoder();
    const body = streamOf([
      encoder.encode(encodeSseEvent("delta", { text: "kept" })),
      encoder.encode('event: delta\ndata: {"text":"lo'),
    ]);
    expect(await collect(body)).toEqual([{ event: "delta", data: '{"text":"kept"}' }]);
  });
});
