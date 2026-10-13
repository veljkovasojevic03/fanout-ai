/**
 * pnpm smoke [baseUrl] — end-to-end API check against a RUNNING app and the
 * real Supabase project in .env.local.
 *
 * It creates a throwaway user with the service-role key, signs it in (through
 * the same cookie format the app uses), drives the whole generator flow over
 * HTTP, and deletes the user again — which cascades to every row it created.
 * Nothing is left behind, pass or fail.
 *
 * This covers what unit tests cannot: real cookies, real RLS, real RPCs and
 * real streaming, together.
 */
import { randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("smoke: Supabase URL, anon key and service-role key must be set in .env.local");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.warn(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

type SseEvent = { event: string; data: Record<string, unknown> };

/** Reads an SSE response to the end, or aborts after `stopAfterDeltas` text chunks. */
async function readSse(response: Response, stopAfterDeltas?: number, abort?: AbortController) {
  const events: SseEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  let deltas = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
        const data = /^data: (.*)$/m.exec(frame)?.[1] ?? "{}";
        events.push({ event, data: JSON.parse(data) as Record<string, unknown> });
        if (event === "delta" && stopAfterDeltas && (deltas += 1) >= stopAfterDeltas) {
          abort?.abort();
        }
      }
    }
  } catch {
    // Aborted on purpose.
  }
  return events;
}

async function main(): Promise<void> {
  const email = `smoke-${Date.now()}@fanout.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`create user: ${createError?.message}`);
  const userId = created.user.id;

  try {
    // Sign in without a password or CAPTCHA: an admin-issued one-time link,
    // verified through the SSR client so the cookies come out in the app's format.
    const jar = new Map<string, string>();
    const browser = createServerClient(SUPABASE_URL!, ANON_KEY!, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value } of cookies) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
    });
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) throw new Error(`generate link: ${linkError.message}`);
    const { error: verifyError } = await browser.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (verifyError) throw new Error(`verify: ${verifyError.message}`);

    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const post = (path: string, body: unknown, signal?: AbortSignal) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(body),
        signal,
      });
    const codeOf = async (response: Response) =>
      ((await response.json()) as { error?: { code?: string } }).error?.code;

    // The profile trigger made this user 'free'. Make it a guest (3 lifetime
    // generations) so the quota limit is cheap to reach.
    const { error: planError } = await admin
      .from("profiles")
      .update({ plan: "guest" })
      .eq("id", userId);
    check("profile created by trigger and set to guest", !planError, planError?.message);

    const request = {
      topic: "Why small teams should ship every week",
      tone: "casual",
      length: "short",
      contentLanguage: "sr",
      keywords: ["timovi"],
      types: ["blog", "x_thread"],
    };

    console.warn("\nGenerate");
    const tooLong = await post("/api/generate", { ...request, length: "long" });
    check("Long length is refused on this plan (403)", tooLong.status === 403);
    check("…with code length_not_allowed", (await codeOf(tooLong)) === "length_not_allowed");

    const blocked = await post("/api/generate", {
      ...request,
      source: { kind: "url", url: "https://169.254.169.254/latest/meta-data/" },
    });
    check("metadata URL as source is refused (422)", blocked.status === 422);
    check("…with code source_blocked", (await codeOf(blocked)) === "source_blocked");

    const invalid = await post("/api/generate", { ...request, types: [] });
    check("invalid input is refused (400)", invalid.status === 400);

    const first = await post("/api/generate", request);
    const firstBody = (await first.json()) as {
      generationId: string;
      mode: string;
      remaining: number;
    };
    check("first generation starts (200)", first.status === 200);
    check(
      "refused requests cost nothing: 2 of 3 left",
      firstBody.remaining === 2,
      `remaining=${firstBody.remaining}`,
    );
    const expectedMode = process.env.ANTHROPIC_API_KEY ? "live" : "sample";
    check(`mode is ${expectedMode}`, firstBody.mode === expectedMode, `mode=${firstBody.mode}`);
    const generationId = firstBody.generationId;

    console.warn("\nStream");
    const blog = await post("/api/generate/stream", { generationId, type: "blog" });
    check(
      "blog stream opens as text/event-stream",
      blog.headers.get("content-type")?.startsWith("text/event-stream") === true,
    );
    const blogEvents = await readSse(blog);
    const text = blogEvents
      .filter((e) => e.event === "delta")
      .map((e) => e.data.text)
      .join("");
    const done = blogEvents.find((e) => e.event === "done");
    check(
      "events arrive in order: meta, deltas, done",
      blogEvents[0]?.event === "meta" && blogEvents.at(-1)?.event === "done",
    );
    check("text was streamed", text.length > 500, `${text.length} chars`);
    check("Serbian output is in Latin script", !/[Ѐ-ӿ]/.test(text));
    check(
      "server reports word count",
      Number(done?.data.words) > 100,
      `words=${String(done?.data.words)}`,
    );
    if (firstBody.mode === "sample") {
      check(
        "sample output passes its format check",
        Array.isArray(done?.data.warnings) && (done?.data.warnings as unknown[]).length === 0,
      );
    }

    const again = await post("/api/generate/stream", { generationId, type: "blog" });
    check("the same piece cannot be streamed twice (409)", again.status === 409);
    check("…with code already_streamed", (await codeOf(again)) === "already_streamed");

    const notSelected = await post("/api/generate/stream", { generationId, type: "email" });
    check("an unselected format is refused (400)", notSelected.status === 400);

    const foreign = await post("/api/generate/stream", {
      generationId: randomUUID(),
      type: "blog",
    });
    check("an unknown generation id is not found (404)", foreign.status === 404);

    const earlyRegen = await post("/api/generate/regenerate", { generationId, type: "x_thread" });
    check("regenerate before the first stream is refused (409)", earlyRegen.status === 409);

    console.warn("\nRegenerate and stop");
    const regen = await post("/api/generate/regenerate", { generationId, type: "blog" });
    const regenEvents = await readSse(regen);
    check("regenerate streams again", regenEvents.at(-1)?.event === "done");
    check(
      "…and uses 1 of 10 regenerations",
      regenEvents[0]?.data.regenerationsLeft === 9,
      `left=${String(regenEvents[0]?.data.regenerationsLeft)}`,
    );
    check("…as attempt 2", regenEvents[0]?.data.attempt === 2);

    const stopper = new AbortController();
    const thread = await post(
      "/api/generate/stream",
      { generationId, type: "x_thread" },
      stopper.signal,
    );
    const partial = await readSse(thread, 5, stopper);
    check(
      "Stop cancels mid-stream",
      !partial.some((e) => e.event === "done") &&
        partial.filter((e) => e.event === "delta").length >= 5,
    );

    // Give the server a moment to notice the disconnect and do its bookkeeping.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const { data: streams } = await admin
      .from("generation_streams")
      .select("type, attempts, completed_at")
      .eq("generation_id", generationId);
    const threadRow = streams?.find((s) => s.type === "x_thread");
    check("a stopped stream is still closed out on the server", Boolean(threadRow?.completed_at));
    check("blog shows 2 attempts", streams?.find((s) => s.type === "blog")?.attempts === 2);

    console.warn("\nQuota");
    const second = await post("/api/generate", { ...request, types: ["linkedin"] });
    const third = await post("/api/generate", { ...request, types: ["instagram"] });
    const fourth = await post("/api/generate", { ...request, types: ["email"] });
    check("2nd and 3rd generations start", second.status === 200 && third.status === 200);
    check("the 4th guest generation is refused (403)", fourth.status === 403);
    check("…with code quota_exhausted", (await codeOf(fourth)) === "quota_exhausted");

    const { data: counter } = await admin
      .from("usage_counters")
      .select("period, generations, words")
      .eq("user_id", userId)
      .maybeSingle();
    check(
      "usage counter: 3 generations, lifetime period",
      counter?.generations === 3 && counter?.period === "lifetime",
      JSON.stringify(counter),
    );
    check("words were counted", Number(counter?.words) > 100, `words=${counter?.words}`);

    const { count } = await admin
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    check("exactly 3 generation rows exist", count === 3, `count=${count}`);

    console.warn("\nIsolation");
    const anonymous = await fetch(`${BASE}/api/generate/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generationId, type: "x_thread" }),
    });
    check("without the session cookie the same request is 401", anonymous.status === 401);
  } finally {
    const { error } = await admin.auth.admin.deleteUser(userId);
    check("\ncleanup: throwaway user deleted", !error, error?.message);
    const { count } = await admin
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    check("cleanup: its rows are gone (cascade)", count === 0, `count=${count}`);
  }
}

main()
  .catch((error: unknown) => {
    failures += 1;
    console.error("smoke: crashed —", error instanceof Error ? error.message : error);
  })
  .finally(() => {
    console.warn(
      failures === 0 ? "\nsmoke: all checks passed" : `\nsmoke: ${failures} check(s) failed`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
