// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { N8N_WEBHOOK_PATHS, toN8nPayload, type DispatchRequest } from "./dispatcher";
import { signedHeaders, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./hmac";
import { callbackSchema } from "./schema";

/*
 * The app and the n8n workflows must agree on the signature scheme, and they
 * are written in two places. These tests take the JavaScript out of the
 * workflow files' Code nodes and run it here, against requests signed by the
 * app's own code — and check the callback the workflow builds with the app's
 * own verifier.
 *
 * n8n itself is not started: `$input`, `$env`, `$()` and `this.helpers` are
 * stand-ins with the shapes n8n documents for the Code node.
 */

const SECRET = "test-shared-secret-0123456789";
const WEBHOOK =
  "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234";
const JOB = "7f0c1d7e-4a52-4b61-9a3e-0d2f6f6f1c11";
const ATTEMPT = "0b9d7c1e-2a34-4c56-8d7e-9f0a1b2c3d4e";

type Node = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  onError?: string;
};
type Workflow = {
  nodes: Node[];
  connections: Record<string, { main: { node: string }[][] }>;
};

const load = (file: string): Workflow =>
  JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../../../n8n/workflows", file), "utf8"),
  );

const WORKFLOWS = {
  email: load("publish-email.json"),
  discord: load("publish-discord.json"),
};

const nodeOf = (workflow: Workflow, name: string) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`node "${name}" not found`);
  return node;
};

type Item = { json: Record<string, unknown> };
type Scope = {
  items: Item[];
  env: Record<string, string | undefined>;
  /** Output of earlier nodes, for `$('Node name')`. */
  previous?: Record<string, Item[]>;
  /** The raw request body, when the Webhook node kept it. */
  rawBody?: string;
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<Item[]>;

/** Runs a Code node's JavaScript the way n8n does: as the body of an async function. */
function runCode(workflow: Workflow, name: string, scope: Scope): Promise<Item[]> {
  const code = String(nodeOf(workflow, name).parameters.jsCode);
  const input = { first: () => scope.items[0], all: () => scope.items };
  const lookup = (node: string) => ({
    first: () => scope.previous?.[node]?.[0],
    all: () => scope.previous?.[node] ?? [],
  });
  const helpers = {
    async getBinaryDataBuffer() {
      if (scope.rawBody === undefined) throw new Error("no binary data");
      return Buffer.from(scope.rawBody, "utf8");
    },
  };
  return new AsyncFunction("$input", "$env", "$", "require", code).call(
    { helpers },
    input,
    scope.env,
    lookup,
    createRequire(import.meta.url),
  );
}

const ENV = { N8N_SHARED_SECRET: SECRET, FANOUT_APP_URL: "http://host.docker.internal:3000/" };

const requests: Record<"email" | "discord", DispatchRequest> = {
  email: {
    jobId: JOB,
    attemptId: ATTEMPT,
    delivery: { kind: "email", to: "me@example.com", subject: "Hello — čćžšđ", text: "Body\n\n😀" },
  },
  discord: {
    jobId: JOB,
    attemptId: ATTEMPT,
    delivery: { kind: "discord", webhookUrl: WEBHOOK, messages: ["One", "Two — čćžšđ"] },
  },
};

/** What the Webhook node hands to the next node for a request signed by the app. */
function incoming(kind: "email" | "discord", now = Date.now()) {
  const body = JSON.stringify(toN8nPayload(requests[kind]));
  const headers = signedHeaders(SECRET, body, now);
  return {
    body,
    item: {
      json: {
        // n8n lower-cases header names.
        headers: {
          "x-timestamp": headers[TIMESTAMP_HEADER],
          "x-signature": headers[SIGNATURE_HEADER],
        },
        body: JSON.parse(body),
      },
    },
  };
}

describe.each(["email", "discord"] as const)("n8n workflow: publish-%s", (kind) => {
  const workflow = WORKFLOWS[kind];
  const verify = (scope: Partial<Scope> & Pick<Scope, "items">) =>
    runCode(workflow, "Verify signature", { env: ENV, ...scope });

  it("listens on the path the dispatcher posts to, and answers only after verifying", () => {
    const webhook = nodeOf(workflow, "Webhook");
    expect(`/webhook/${webhook.parameters.path}`).toBe(N8N_WEBHOOK_PATHS[kind]);
    expect(webhook.parameters.httpMethod).toBe("POST");
    // The response comes from the "Accept" node, which sits behind the signature check.
    expect(webhook.parameters.responseMode).toBe("responseNode");
    expect(webhook.parameters.options).toMatchObject({ rawBody: true });
    expect(workflow.connections.Webhook!.main[0]![0]!.node).toBe("Verify signature");
    expect(workflow.connections["Verify signature"]!.main[0]![0]!.node).toBe("Accept");
  });

  it("accepts a request signed by the app (raw body)", async () => {
    const { body, item } = incoming(kind);
    const [out] = await verify({ items: [item], rawBody: body });
    expect(out!.json).toEqual(toN8nPayload(requests[kind]));
  });

  it("accepts it without the raw copy too, by re-serialising the parsed body", async () => {
    const { item } = incoming(kind);
    const [out] = await verify({ items: [item] });
    expect(out!.json).toEqual(toN8nPayload(requests[kind]));
  });

  it("rejects a tampered body", async () => {
    const { body, item } = incoming(kind);
    const tampered = body.replace(JOB, "00000000-0000-4000-8000-000000000000");
    await expect(verify({ items: [item], rawBody: tampered })).rejects.toThrow("Invalid signature");

    const parsedOnly = { json: { ...item.json, body: JSON.parse(tampered) } };
    await expect(verify({ items: [parsedOnly] })).rejects.toThrow("Invalid signature");
  });

  it("rejects a wrong secret, a missing signature and a stale timestamp", async () => {
    const { body, item } = incoming(kind);
    await expect(
      verify({
        items: [item],
        rawBody: body,
        env: { ...ENV, N8N_SHARED_SECRET: "some-other-secret-0123456789" },
      }),
    ).rejects.toThrow("Invalid signature");

    const unsigned = { json: { ...item.json, headers: {} } };
    await expect(verify({ items: [unsigned], rawBody: body })).rejects.toThrow("Invalid signature");

    const old = incoming(kind, Date.now() - 6 * 60_000);
    await expect(verify({ items: [old.item], rawBody: old.body })).rejects.toThrow("Stale request");
  });

  it("refuses to run without a usable secret", async () => {
    const { body, item } = incoming(kind);
    for (const secret of [undefined, "short"]) {
      await expect(
        verify({ items: [item], rawBody: body, env: { ...ENV, N8N_SHARED_SECRET: secret } }),
      ).rejects.toThrow("N8N_SHARED_SECRET");
    }
  });

  it("refuses a correctly signed request meant for the other workflow", async () => {
    const other = incoming(kind === "email" ? "discord" : "email");
    await expect(verify({ items: [other.item], rawBody: other.body })).rejects.toThrow(
      "Unexpected payload",
    );
  });

  it("builds a callback the app's verifier accepts", async () => {
    const [out] = await runCode(workflow, "Build callback", {
      items: [{ json: {} }],
      env: ENV,
      previous: { "Verify signature": [{ json: toN8nPayload(requests[kind]) as never }] },
    });
    const { url, body, timestamp, signature } = out!.json as {
      url: string;
      body: string;
      timestamp: string;
      signature: string;
    };

    expect(url).toBe("http://host.docker.internal:3000/api/publish/callback");
    expect(verifySignature({ secret: SECRET, timestamp, signature, body })).toEqual({ ok: true });
    expect(callbackSchema.parse(JSON.parse(body))).toEqual({
      jobId: JOB,
      attemptId: ATTEMPT,
      ok: true,
    });
  });

  it("reports a failed delivery with the HTTP status and nothing else", async () => {
    const [out] = await runCode(workflow, "Build callback", {
      items: [
        { json: {} },
        { json: { error: { message: `Request to ${WEBHOOK} failed`, httpCode: "429" } } },
      ],
      env: ENV,
      previous: { "Verify signature": [{ json: toN8nPayload(requests[kind]) as never }] },
    });
    const body = String(out!.json.body);

    expect(callbackSchema.parse(JSON.parse(body))).toEqual({
      jobId: JOB,
      attemptId: ATTEMPT,
      ok: false,
      error: "delivery_failed",
      httpStatus: 429,
    });
    // Neither the message text nor the webhook URL travels back.
    expect(body).not.toContain("discord.com");
    expect(body).not.toContain("Request to");
  });

  it("keeps going to the callback when the delivery node fails", () => {
    const delivery = nodeOf(workflow, kind === "email" ? "Send email" : "Post to Discord");
    expect(delivery.onError).toBe("continueRegularOutput");
    expect(nodeOf(workflow, "Send callback").parameters).toMatchObject({
      method: "POST",
      contentType: "raw",
      rawContentType: "application/json",
      body: "={{ $json.body }}",
    });
  });

  it("contains no secret, address or webhook URL of its own", () => {
    const text = JSON.stringify(workflow);
    expect(text).not.toMatch(/discord\.com\/api\/webhooks\/\d/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toContain("credentials");
  });
});

describe("n8n workflow: publish-discord", () => {
  const workflow = WORKFLOWS.discord;

  it("only ever posts to a Discord webhook, even when the request is correctly signed", async () => {
    for (const webhookUrl of [
      "http://169.254.169.254/latest/meta-data",
      "https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    ]) {
      const body = JSON.stringify({
        ...toN8nPayload(requests.discord),
        discord: { webhookUrl, messages: ["x"] },
      });
      const headers = signedHeaders(SECRET, body);
      const item = {
        json: {
          headers: {
            "x-timestamp": headers[TIMESTAMP_HEADER],
            "x-signature": headers[SIGNATURE_HEADER],
          },
          body: JSON.parse(body),
        },
      };
      await expect(
        runCode(workflow, "Verify signature", { items: [item], env: ENV, rawBody: body }),
      ).rejects.toThrow("Unexpected payload");
    }
  });

  it("posts the messages one at a time, in order, with mentions switched off", async () => {
    const items = await runCode(workflow, "Split messages", {
      items: [{ json: toN8nPayload(requests.discord) as never }],
      env: ENV,
    });
    expect(items.map((item) => item.json)).toEqual([
      { webhookUrl: WEBHOOK, content: "One", index: 0 },
      { webhookUrl: WEBHOOK, content: "Two — čćžšđ", index: 1 },
    ]);

    const post = nodeOf(workflow, "Post to Discord").parameters;
    expect(post.url).toBe("={{ $json.webhookUrl }}");
    expect(String(post.jsonBody)).toContain("allowed_mentions: { parse: [] }");
    expect(post.options).toMatchObject({ batching: { batch: { batchSize: 1 } } });
  });
});
