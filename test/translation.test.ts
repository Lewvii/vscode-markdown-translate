import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import test, { type TestContext } from "node:test";
import { normalizeEndpoint, translateBatch, TranslationAuthenticationError, type TranslationSegment, type TranslationSettings } from "../src/translation";

async function serve(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}

const settings: TranslationSettings = { endpoint: "", model: "local-model", targetLanguage: "简体中文" };
const translated = "# 译文\n\n保留 `code()`。\n";
const source: readonly TranslationSegment[] = [{ id: "first", text: "Source", markers: [] }];

function completion(content: string): string {
  return JSON.stringify({ choices: [{ finish_reason: "stop", message: { role: "assistant", content } }] });
}

function batch(segments: readonly { id: string; text: string }[]): string {
  return completion(JSON.stringify({ segments }));
}

const invalidResponses: { name: string; body: unknown }[] = [
  { name: "missing choices", body: {} },
  { name: "null response", body: null },
  { name: "empty choices", body: { choices: [] } },
  { name: "non-object choice", body: { choices: [null] } },
  { name: "missing completion marker", body: { choices: [{ message: { role: "assistant", content: "部分" } }] } },
  { name: "truncated completion", body: { choices: [{ finish_reason: "length", message: { role: "assistant", content: "部分" } }] } },
  { name: "filtered completion", body: { choices: [{ finish_reason: "content_filter", message: { role: "assistant", content: "部分" } }] } },
  { name: "refusal with text", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "拒绝原因", refusal: "private refusal" } }] } },
  { name: "empty content", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: " \n " } }] } },
  { name: "content parts", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "译文" }] } }] } },
  { name: "non-assistant message", body: { choices: [{ finish_reason: "stop", message: { role: "user", content: "不是译文" } }] } },
  { name: "tool call completion", body: { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: "部分" } }] } },
  { name: "tool call with stop marker", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "部分", tool_calls: [{ id: "call" }] } }] } },
  { name: "function call with stop marker", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "部分", function_call: { name: "call" } } }] } },
  { name: "malformed tool calls", body: { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "部分", tool_calls: {} } }] } },
];

for (const entry of invalidResponses) {
  test(`rejects ${entry.name} instead of publishing a translation`, async t => {
    const endpoint = await serve(t, (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(entry.body));
    });
    await assert.rejects(translateBatch(source, { ...settings, endpoint }, "", new AbortController().signal));
  });
}

test("returns a complete translation from a local provider without requiring an API key", async t => {
  const endpoint = await serve(t, (request, response) => {
    assert.equal(request.headers.authorization, undefined);
    response.end(batch([{ id: "first", text: translated }]));
  });
  assert.deepEqual(await translateBatch(source, { ...settings, endpoint }, "", new AbortController().signal), new Map([["first", translated]]));
});

test("sends one ID-addressed request without local metadata and accepts reordered translations", async t => {
  const segments = [
    { id: "heading", text: "Heading", markers: [], formatting: "<h1>private local HTML</h1>" },
    { id: "paragraph", text: "Read ⟦FORMAT_0⟧the guide⟦FORMAT_1⟧ and ⟦INLINE_CODE_0⟧.", markers: ["⟦FORMAT_0⟧", "⟦FORMAT_1⟧", "⟦INLINE_CODE_0⟧"], formatting: "https://private.example/guide code()" },
  ];
  const translations = [
    { id: "paragraph", text: "阅读 ⟦FORMAT_0⟧指南⟦FORMAT_1⟧和 ⟦INLINE_CODE_0⟧。" },
    { id: "heading", text: "标题" },
  ];
  let requests = 0;
  const endpoint = await serve(t, (request, response) => {
    requests++;
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer private-key");
    assert.equal(request.headers["content-type"], "application/json");
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(payload !== null && typeof payload === "object");
      assert("model" in payload && payload.model === "local-model");
      assert("stream" in payload && payload.stream === false);
      assert(!("response_format" in payload));
      assert("messages" in payload && Array.isArray(payload.messages));
      const userMessage: unknown = payload.messages.find((message: unknown) => message !== null && typeof message === "object" && "role" in message && message.role === "user");
      assert(userMessage !== null && typeof userMessage === "object" && "content" in userMessage && typeof userMessage.content === "string");
      assert.deepEqual(JSON.parse(userMessage.content), { segments: [
        { id: "heading", text: "Heading" },
        { id: "paragraph", text: "Read ⟦FORMAT_0⟧the guide⟦FORMAT_1⟧ and ⟦INLINE_CODE_0⟧." },
      ] });
      const serialized = JSON.stringify(payload);
      assert(!serialized.includes("private local HTML"));
      assert(!serialized.includes("private.example"));
      assert(!serialized.includes("code()"));
      assert(!serialized.includes('"markers"'));
      assert(!serialized.includes('"formatting"'));
      response.end(batch(translations));
    });
  });
  const result = await translateBatch(segments, { ...settings, endpoint }, "private-key", new AbortController().signal);
  assert.equal(requests, 1);
  assert.equal(result.size, 2);
  assert.equal(result.get("heading"), "标题");
  assert.equal(result.get("paragraph"), "阅读 ⟦FORMAT_0⟧指南⟦FORMAT_1⟧和 ⟦INLINE_CODE_0⟧。");
});

const pair: readonly TranslationSegment[] = [
  { id: "first", text: "First", markers: [] },
  { id: "second", text: "Second", markers: [] },
];
const invalidBatches: { name: string; content: string }[] = [
  { name: "plain prose", content: "private-provider-output" },
  { name: "malformed batch JSON", content: '{"segments":[' },
  { name: "fenced JSON", content: '```json\n{"segments":[]}\n```' },
  { name: "null batch", content: "null" },
  { name: "missing segments", content: "{}" },
  { name: "non-array segments", content: '{"segments":{}}' },
  { name: "missing ID", content: '{"segments":[{"id":"first","text":"第一"}]}' },
  { name: "unknown ID", content: '{"segments":[{"id":"first","text":"第一"},{"id":"unknown","text":"第二"}]}' },
  { name: "duplicate ID", content: '{"segments":[{"id":"first","text":"第一"},{"id":"first","text":"重复"}]}' },
  { name: "extra ID", content: '{"segments":[{"id":"first","text":"第一"},{"id":"second","text":"第二"},{"id":"extra","text":"额外"}]}' },
  { name: "empty batch", content: '{"segments":[]}' },
  { name: "non-object segment", content: '{"segments":[{"id":"first","text":"第一"},null]}' },
  { name: "non-string ID", content: '{"segments":[{"id":"first","text":"第一"},{"id":2,"text":"第二"}]}' },
  { name: "missing text", content: '{"segments":[{"id":"first","text":"第一"},{"id":"second"}]}' },
  { name: "non-string text", content: '{"segments":[{"id":"first","text":"第一"},{"id":"second","text":2}]}' },
  { name: "blank text", content: '{"segments":[{"id":"first","text":"第一"},{"id":"second","text":" \\n "}]}' },
];

for (const entry of invalidBatches) {
  test(`rejects the entire batch for ${entry.name}`, async t => {
    const endpoint = await serve(t, (_request, response) => response.end(completion(entry.content)));
    await assert.rejects(translateBatch(pair, { ...settings, endpoint }, "private-key", new AbortController().signal), error => {
      assert(error instanceof Error);
      assert(!error.message.includes(entry.content));
      assert(!error.message.includes(endpoint));
      assert(!error.message.includes("private-key"));
      return true;
    });
  });
}

const marked: readonly TranslationSegment[] = [
  ...source,
  { id: "second", text: "Read ⟦FORMAT_0⟧the guide⟦FORMAT_1⟧ and ⟦INLINE_CODE_0⟧.", markers: ["⟦FORMAT_0⟧", "⟦FORMAT_1⟧", "⟦INLINE_CODE_0⟧"] },
];

for (const entry of [
  { name: "missing", text: "没有标记" },
  { name: "duplicated", text: "⟦FORMAT_0⟧ ⟦FORMAT_0⟧ ⟦FORMAT_1⟧ ⟦INLINE_CODE_0⟧" },
  { name: "reordered", text: "⟦FORMAT_1⟧ ⟦FORMAT_0⟧ ⟦INLINE_CODE_0⟧" },
  { name: "altered", text: "⟦FORMAT_00⟧ ⟦FORMAT_1⟧ ⟦INLINE_CODE_0⟧" },
  { name: "added", text: "⟦FORMAT_0⟧ ⟦FORMAT_1⟧ ⟦INLINE_CODE_0⟧ ⟦INLINE_CODE_1⟧" },
  { name: "broken", text: "⟦FORMAT_0⟧ ⟦FORMAT_1⟧ ⟦INLINE_CODE_0" },
]) {
  test(`rejects the entire batch when a later segment has ${entry.name} markers`, async t => {
    const endpoint = await serve(t, (_request, response) => response.end(batch([
      { id: "first", text: "有效译文" },
      { id: "second", text: entry.text },
    ])));
    await assert.rejects(translateBatch(marked, { ...settings, endpoint }, "", new AbortController().signal), /formatting markers/i);
  });
}

test("rejects invented markers in otherwise unformatted prose", async t => {
  const endpoint = await serve(t, (_request, response) => response.end(batch([{ id: "first", text: "⟦FORMAT_0⟧译文⟦FORMAT_1⟧" }])));
  await assert.rejects(translateBatch(source, { ...settings, endpoint }, "", new AbortController().signal), /formatting markers/i);
});

test("rejects malformed JSON without disclosing the response or credentials", async t => {
  const secret = "private-provider-output-and-key";
  const endpoint = await serve(t, (_request, response) => response.end(`{"secret":"${secret}`));
  await assert.rejects(translateBatch(source, { ...settings, endpoint }, secret, new AbortController().signal), error => {
    assert(error instanceof Error);
    assert.match(error.message, /JSON/);
    assert(!error.message.includes(secret));
    assert(!error.message.includes(endpoint));
    return true;
  });
});

for (const status of [401, 403, 429, 500]) {
  test(`reports HTTP ${status} without disclosing the provider body`, async t => {
    const secret = "private-provider-output-and-key";
    const endpoint = await serve(t, (_request, response) => {
      response.writeHead(status);
      response.end(secret);
    });
    await assert.rejects(translateBatch(source, { ...settings, endpoint }, secret, new AbortController().signal), error => {
      assert(error instanceof Error);
      assert.equal(error instanceof TranslationAuthenticationError, status === 401 || status === 403);
      assert.match(error.message, status === 401 || status === 403 ? /denied/i : status === 429 ? /quota/i : /HTTP 500/);
      assert(!error.message.includes(secret));
      assert(!error.message.includes(endpoint));
      return true;
    });
  });
}

test("rejects redirects without contacting their destination", async t => {
  let destinationRequests = 0;
  const destination = await serve(t, (_request, response) => {
    destinationRequests++;
    response.end(batch([{ id: "first", text: translated }]));
  });
  const endpoint = await serve(t, (_request, response) => {
    response.writeHead(307, { Location: destination });
    response.end();
  });
  await assert.rejects(translateBatch(source, { ...settings, endpoint }, "private-key", new AbortController().signal));
  assert.equal(destinationRequests, 0);
});

test("reports disconnected services with a local error", async t => {
  const endpoint = await serve(t, (request, _response) => request.socket.destroy());
  await assert.rejects(translateBatch(source, { ...settings, endpoint }, "private-key", new AbortController().signal), error => {
    assert(error instanceof Error);
    assert(!error.message.includes(endpoint));
    assert(!error.message.includes("private-key"));
    return true;
  });
});

for (const bodyStarted of [false, true]) {
  test(`cancels an active request ${bodyStarted ? "with an unfinished body" : "before headers"}`, { timeout: 5_000 }, async t => {
    const controller = new AbortController();
    const endpoint = await serve(t, (_request, response) => {
      if (bodyStarted) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write("{\"choices\":[");
      }
      controller.abort(new Error("private cancellation reason"));
    });
    await assert.rejects(translateBatch(source, { ...settings, endpoint }, "", controller.signal), /cancel/i);
  });
}

test("an already cancelled request never contacts the service", async t => {
  let requests = 0;
  const endpoint = await serve(t, (_request, response) => {
    requests++;
    response.end();
  });
  const controller = new AbortController();
  controller.abort(new Error("private cancellation reason"));
  await assert.rejects(translateBatch(source, { ...settings, endpoint }, "", controller.signal), /cancel/i);
  assert.equal(requests, 0);
});

test("invalid local input never contacts the service", async t => {
  let requests = 0;
  const endpoint = await serve(t, (_request, response) => {
    requests++;
    response.end();
  });
  await assert.rejects(translateBatch([{ id: "first", text: " \n", markers: [] }], { ...settings, endpoint }, "", new AbortController().signal));
  await assert.rejects(translateBatch(source, { ...settings, endpoint, model: " " }, "", new AbortController().signal));
  await assert.rejects(translateBatch(source, { ...settings, endpoint, targetLanguage: " " }, "", new AbortController().signal));
  await assert.rejects(translateBatch([{ id: " ", text: "Source", markers: [] }], { ...settings, endpoint }, "", new AbortController().signal));
  await assert.rejects(translateBatch([...source, ...source], { ...settings, endpoint }, "", new AbortController().signal));
  assert.equal(requests, 0);
});

test("an empty batch returns no translations without contacting the service", async t => {
  let requests = 0;
  const endpoint = await serve(t, (_request, response) => {
    requests++;
    response.end();
  });
  assert.deepEqual(await translateBatch([], { ...settings, endpoint }, "", new AbortController().signal), new Map());
  assert.equal(requests, 0);
});

test("endpoint normalization accepts HTTPS and loopback HTTP only", () => {
  assert.equal(normalizeEndpoint(" https://EXAMPLE.com:443/v1/chat/completions "), "https://example.com/v1/chat/completions");
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(normalizeEndpoint(`http://${host}:8080/chat/completions`), `http://${host}:8080/chat/completions`);
  }
  for (const endpoint of [
    "not a URL", "https:example.com", "//example.com/api", "http://example.com/api", "http://localhost.evil.test/api",
    "file:///etc/passwd", "ftp://example.com/api", "https://user:private-key@example.com/api", "https://@example.com/api",
    "https://example.com/api?secret=private-key", "https://example.com/api?", "https://example.com/api#fragment", "https://example.com/api#",
    "https://exam\nple.com/api", "https://example.com\\api",
  ]) {
    assert.throws(() => normalizeEndpoint(endpoint), error => {
      assert(error instanceof Error);
      assert(!error.message.includes("private-key"));
      return true;
    });
  }
});
