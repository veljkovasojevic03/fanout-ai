import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTL_LOCALE } from "@/i18n/config";
import { encodeSseEvent } from "@/lib/generation/sse";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import { HeroDemo, type DemoTopic } from "./hero-demo";
import { Reveal } from "./reveal";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const TOPICS: DemoTopic[] = [
  { id: "product_launch", label: "Product launch", topic: "Launching a habit tracker" },
  { id: "thought_leadership", label: "Thought-leadership post", topic: "Why small teams ship" },
];

/** A finished SSE response, as POST /api/demo/stream sends it. */
function sseResponse(text: string) {
  const encoder = new TextEncoder();
  const events: [string, unknown][] = [
    ["meta", { mode: "sample", model: null, attempt: 1, regenerationsLeft: null }],
    ["delta", { text }],
    ["done", { words: 2, chars: text.length, warnings: [], inputTokens: 0, outputTokens: 0 }],
  ];
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const [event, data] of events) {
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("HeroDemo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => sseResponse("Sample text."));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const demo = (locale: "en" | "sr" = "en") =>
    render(
      <NextIntlClientProvider locale={INTL_LOCALE[locale]} messages={locale === "en" ? en : sr}>
        <HeroDemo topics={TOPICS} defaultLanguage={locale} />
      </NextIntlClientProvider>,
    );

  it("shows five waiting cards and calls nothing until Generate is pressed", () => {
    demo();

    const results = screen.getByRole("region", { name: "Demo results" });
    expect(within(results).getAllByText("Waiting for an idea…")).toHaveLength(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the selected topic, read-only", () => {
    demo();

    const topic = screen.getByLabelText("Topic") as HTMLInputElement;
    expect(topic).toHaveValue("Launching a habit tracker");
    expect(topic.readOnly).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Thought-leadership post" }));
    expect(topic).toHaveValue("Why small teams ship");
  });

  it("streams all five formats from the public demo endpoint, for the chosen topic and language", async () => {
    demo();

    fireEvent.click(screen.getByRole("radio", { name: "Thought-leadership post" }));
    fireEvent.click(screen.getByRole("radio", { name: "Serbian" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    });

    // The cards are a dynamic import: give the first load time on a busy test run.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5), { timeout: 8000 });
    const bodies = fetchMock.mock.calls.map(([url, init]) => {
      expect(url).toBe("/api/demo/stream");
      return JSON.parse(String((init as RequestInit).body));
    });
    expect(bodies.map((body) => body.type).sort()).toEqual(
      ["blog", "email", "instagram", "linkedin", "x_thread"].sort(),
    );
    for (const body of bodies) {
      expect(body).toMatchObject({ fixture: "thought_leadership", language: "sr" });
    }

    // Every card is labelled as sample output, and nothing offers to save it.
    await waitFor(() => expect(screen.getAllByText("Sample output")).toHaveLength(5), {
      timeout: 8000,
    });
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    // Same choice again: the button says so.
    expect(screen.getByRole("button", { name: "Generate again" })).toBeInTheDocument();
  });

  it("starts in the interface language", () => {
    demo("sr");
    expect(screen.getByRole("radio", { name: "Srpski" })).toHaveAttribute("data-state", "on");
  });
});

describe("Reveal", () => {
  type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
  let observers: { callback: Callback; disconnect: ReturnType<typeof vi.fn> }[];
  let reducedMotion: boolean;

  beforeEach(() => {
    observers = [];
    reducedMotion = false;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect = vi.fn();
        constructor(callback: Callback) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reducedMotion && query.includes("reduce"),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const content = () => screen.getByText("Section").parentElement!;

  it("renders visible on the server side of things (no attribute before the observer reports)", () => {
    render(
      <Reveal>
        <p>Section</p>
      </Reveal>,
    );
    expect(content()).not.toHaveAttribute("data-reveal");
  });

  it("hides content that starts below the fold, and shows it when it scrolls in", () => {
    render(
      <Reveal>
        <p>Section</p>
      </Reveal>,
    );
    act(() => observers[0]!.callback([{ isIntersecting: false }]));
    expect(content()).toHaveAttribute("data-reveal", "hidden");

    act(() => observers[0]!.callback([{ isIntersecting: true }]));
    expect(content()).toHaveAttribute("data-reveal", "shown");
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("never hides content that is already on screen", () => {
    render(
      <Reveal>
        <p>Section</p>
      </Reveal>,
    );
    act(() => observers[0]!.callback([{ isIntersecting: true }]));
    expect(content()).not.toHaveAttribute("data-reveal");
  });

  it("does nothing at all with reduced motion", () => {
    reducedMotion = true;
    render(
      <Reveal>
        <p>Section</p>
      </Reveal>,
    );
    expect(observers).toHaveLength(0);
    expect(content()).not.toHaveAttribute("data-reveal");
  });
});
