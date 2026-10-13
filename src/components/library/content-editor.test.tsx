import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeSseEvent } from "@/lib/generation/sse";

import en from "../../../messages/en.json";

import { ContentEditor, type EditorContent } from "./content-editor";
import { useAutosave } from "./use-autosave";

const actions = vi.hoisted(() => ({
  updateContentAction: vi.fn(),
  deleteContentAction: vi.fn(),
  duplicateContentAction: vi.fn(),
}));

vi.mock("@/lib/library/actions", () => actions);
// The publish dialog has its own tests; here it only must not pull in server code.
vi.mock("@/lib/publish/actions", () => ({
  createPublishJobAction: vi.fn(),
  getPublishOptionsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ID = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const BODY = "First paragraph stays.\n\nSecond paragraph is long.\n\nThird paragraph stays.";

const content = (overrides: Partial<EditorContent> = {}): EditorContent => ({
  id: ID,
  type: "linkedin",
  title: "My post",
  body: BODY,
  language: "en",
  tags: ["launch"],
  ...overrides,
});

function renderEditor(overrides: Partial<EditorContent> = {}, refinementsLeft: number | null = 7) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ContentEditor
        content={content(overrides)}
        knownTags={["launch", "pricing"]}
        refinementsLeft={refinementsLeft}
      />
    </NextIntlClientProvider>,
  );
}

/** A finished SSE response, as POST /api/refine sends it. */
function sseResponse(text: string, meta: Record<string, unknown> = {}) {
  const encoder = new TextEncoder();
  const events: [string, unknown][] = [
    ["meta", { mode: "sample", model: null, attempt: 1, regenerationsLeft: 6, ...meta }],
    ...text.split(/(?<= )/).map((chunk): [string, unknown] => ["delta", { text: chunk }]),
    ["done", { words: 1, chars: text.length, warnings: [], inputTokens: 0, outputTokens: 0 }],
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [event, data] of events)
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const textarea = () => screen.getByLabelText("Text") as HTMLTextAreaElement;

function lastRefineRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

beforeEach(() => {
  actions.updateContentAction.mockResolvedValue({
    ok: true,
    updatedAt: new Date().toISOString(),
    tags: [],
    title: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useAutosave", () => {
  const setup = (
    save: (value: { text: string }) => Promise<{ ok: true } | { ok: false; code: "x" }>,
  ) =>
    renderHook(
      ({ text }) =>
        useAutosave({ value: { text }, save, fallbackError: "x" as const, delayMs: 20 }),
      { initialProps: { text: "a" } },
    );

  it("starts saved, saves after the quiet period and reports each state", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result, rerender } = setup(save);
    expect(result.current.status).toBe("saved");

    rerender({ text: "ab" });
    expect(result.current.status).toBe("dirty");
    expect(save).not.toHaveBeenCalled();

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledExactlyOnceWith({ text: "ab" });
  });

  it("debounces: several quick changes become one save of the last value", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result, rerender } = setup(save);

    rerender({ text: "ab" });
    rerender({ text: "abc" });
    rerender({ text: "abcd" });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledExactlyOnceWith({ text: "abcd" });
  });

  it("saves changes made during a save right after it, never two at once", async () => {
    let release: (() => void) | undefined;
    let running = 0;
    let maxRunning = 0;
    const save = vi.fn(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => (release = resolve));
      running -= 1;
      return { ok: true } as const;
    });
    const { result, rerender } = setup(save);

    rerender({ text: "ab" });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe("saving");

    rerender({ text: "abc" });
    await act(async () => release?.());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await act(async () => release?.());

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenLastCalledWith({ text: "abc" });
    expect(maxRunning).toBe(1);
  });

  it("reports a failed save and does not retry it in a loop", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, code: "x" });
    const { result, rerender } = setup(save);

    rerender({ text: "ab" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("x");

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("treats a thrown save as a failure, and flush() retries it", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true });
    const { result, rerender } = setup(save);

    rerender({ text: "ab" });
    await waitFor(() => expect(result.current.status).toBe("error"));

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(result.current.status).toBe("saved");
    expect(result.current.error).toBeNull();
  });

  it("flush() resolves true straight away when there is nothing to save", async () => {
    const save = vi.fn();
    const { result } = setup(save);
    await expect(result.current.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("ContentEditor", () => {
  it("autosaves an edit and shows the save state", async () => {
    renderEditor();
    expect(screen.getByText("Saved")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  A better title " } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await waitFor(() => expect(actions.updateContentAction).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });
    expect(actions.updateContentAction).toHaveBeenCalledWith({
      id: ID,
      title: "  A better title ",
      body: BODY,
      language: "en",
      tags: ["launch"],
    });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("does not send a save for an empty title, and says why", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });

    expect(screen.getByRole("alert")).toHaveTextContent(en.editor.errors.title_required);
    await waitFor(() => expect(screen.getByText("Not saved")).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(actions.updateContentAction).not.toHaveBeenCalled();
  });

  it("shows why a save failed and keeps the text", async () => {
    actions.updateContentAction.mockResolvedValue({ ok: false, code: "save_failed" });
    renderEditor();

    fireEvent.change(textarea(), { target: { value: "Changed text" } });

    await waitFor(
      () => expect(screen.getByRole("alert")).toHaveTextContent(en.editor.errors.save_failed),
      { timeout: 4000 },
    );
    expect(textarea()).toHaveValue("Changed text");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("refines the whole piece, applies it on Accept and puts it back on Undo", async () => {
    const fetchMock = vi.fn(async () => sseResponse("A much shorter piece."));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));

    // The piece is locked and untouched while the suggestion streams in.
    expect(textarea()).toHaveAttribute("readonly");
    const accept = await screen.findByRole("button", { name: "Accept" });
    await waitFor(() => expect(accept).toBeEnabled());
    expect(textarea()).toHaveValue(BODY);

    const sent = lastRefineRequest(fetchMock);
    expect(sent.url).toBe("/api/refine");
    expect(sent.body).toEqual({
      contentId: ID,
      action: "shorten",
      scope: "all",
      text: BODY,
      language: "en",
    });
    // The server said how many refinements are left.
    expect(screen.getByText(/6 of 10 refinements left/)).toBeInTheDocument();
    expect(screen.getByText(en.editor.refine.sampleNote)).toBeInTheDocument();

    fireEvent.click(accept);
    expect(textarea()).toHaveValue("A much shorter piece.");
    expect(textarea()).not.toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(textarea()).toHaveValue(BODY);
    expect(screen.getByRole("button", { name: "Undo last change" })).toBeDisabled();
  });

  it("refines only the selected text and keeps the whitespace around it", async () => {
    const fetchMock = vi.fn(async () => sseResponse("  Second paragraph, expanded.\n"));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    const selected = "\nSecond paragraph is long.\n";
    const start = BODY.indexOf(selected);
    textarea().setSelectionRange(start, start + selected.length);
    fireEvent.select(textarea());
    expect(screen.getByText(/Applies to the selected text \(27 characters\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    const accept = await screen.findByRole("button", { name: "Accept" });
    await waitFor(() => expect(accept).toBeEnabled());

    expect(lastRefineRequest(fetchMock).body).toMatchObject({
      action: "expand",
      scope: "selection",
      text: selected,
    });

    fireEvent.click(accept);
    expect(textarea()).toHaveValue(
      "First paragraph stays.\n\nSecond paragraph, expanded.\n\nThird paragraph stays.",
    );
  });

  it("leaves the piece alone when a suggestion is discarded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse("Something else entirely.")),
    );
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(textarea()).toHaveValue(BODY);
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last change" })).toBeDisabled();
  });

  it("translates the whole piece into the other language and switches its language", async () => {
    const fetchMock = vi.fn(async () => sseResponse("Prvi pasus ostaje."));
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Translate to Serbian" }));
    const accept = await screen.findByRole("button", { name: "Accept" });
    await waitFor(() => expect(accept).toBeEnabled());
    expect(lastRefineRequest(fetchMock).body).toMatchObject({
      action: "translate",
      language: "en",
      targetLanguage: "sr",
    });

    fireEvent.click(accept);
    expect(textarea()).toHaveValue("Prvi pasus ostaje.");
    // The next translation goes the other way.
    expect(screen.getByRole("button", { name: "Translate to English" })).toBeInTheDocument();
  });

  it("shows the server's reason when a refine is refused, and changes nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "sample_unsupported", message: "x" } }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Translate to Serbian" }));

    expect(await screen.findByText(en.generate.errors.sample_unsupported)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(textarea()).toHaveValue(BODY);
  });

  it("disables refine when the generation's budget is used up", () => {
    renderEditor({}, 0);
    for (const name of ["Shorten", "Expand", "Change tone", "Translate to Serbian"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText(en.generate.errors.refinement_cap_reached)).toBeInTheDocument();
  });

  it("has no refine counter for a piece that did not come from a generation", () => {
    renderEditor({}, null);
    expect(screen.queryByText(/refinements left/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shorten" })).toBeEnabled();
  });

  it("asks before deleting", async () => {
    actions.deleteContentAction.mockResolvedValue({ ok: true });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete this piece?");
    expect(dialog).toHaveTextContent("My post");
    expect(actions.deleteContentAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(actions.deleteContentAction).not.toHaveBeenCalled();
  });
});
