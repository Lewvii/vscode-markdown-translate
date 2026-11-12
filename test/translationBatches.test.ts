import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import test, { type TestContext } from "node:test";
import { type TranslationSegment, type TranslationSettings } from "../src/translation";
import { translateSegments } from "../src/translationBatches";

type WireSegment = Pick<TranslationSegment, "id" | "text">;
type BatchRequest = {
  segments: WireSegment[];
  payload: string;
  response: ServerResponse;
  closed: Promise<void>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function serve(t: TestContext, handle?: (request: BatchRequest) => void) {
  const requests: BatchRequest[] = [];
  const arrivals = new EventEmitter();
  let active = 0;
  let maxActive = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert(isObject(body) && Array.isArray(body.messages));
      const message: unknown = body.messages.find((value: unknown) => isObject(value) && value.role === "user");
      assert(isObject(message) && typeof message.content === "string");
      const payload: unknown = JSON.parse(message.content);
      assert(isObject(payload) && Array.isArray(payload.segments));
      const segments = payload.segments.map((value: unknown) => {
        assert(isObject(value) && typeof value.id === "string" && typeof value.text === "string");
        assert.deepEqual(Object.keys(value).sort(), ["id", "text"]);
        return { id: value.id, text: value.text };
      });
      active++;
      maxActive = Math.max(maxActive, active);
      const closed = once(response, "close").then(() => {
        active--;
      });
      const batch = { segments, payload: message.content, response, closed };
      requests.push(batch);
      arrivals.emit("request");
      handle?.(batch);
    });
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
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    requests,
    get active() { return active; },
    get maxActive() { return maxActive; },
    async waitForRequests(count: number) {
      while (requests.length < count) await once(arrivals, "request", { signal: t.signal });
    },
  };
}

function reply(batch: BatchRequest): void {
  batch.response.writeHead(200, { "Content-Type": "application/json" });
  batch.response.end(JSON.stringify({
    choices: [{
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({ segments: [...batch.segments].reverse().map(({ id }) => ({ id, text: `译文 ${id}` })) }),
      },
    }],
  }));
}

const settings: TranslationSettings = { endpoint: "", model: "local-model", targetLanguage: "简体中文" };
const segment = (id: string, text: string): TranslationSegment => ({ id, text, markers: [] });
const longDocument = () => Array.from({ length: 7 }, (_, index) => segment(`paragraph-${index}`, "Source ".repeat(2_000)));

test("a short document sends every segment in one request and publishes translations by ID", { timeout: 5_000 }, async t => {
  const provider = await serve(t, reply);
  const segments = Array.from({ length: 80 }, (_, index) => segment(`paragraph-${index}`, `English paragraph ${index}.`));
  const published: ReadonlyMap<string, string>[] = [];
  await translateSegments(segments, { ...settings, endpoint: provider.endpoint }, "", new AbortController().signal, batch => published.push(batch));
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(provider.requests[0].segments, segments.map(({ id, text }) => ({ id, text })));
  assert.equal(published.length, 1);
  assert.equal(published[0].size, segments.length);
  for (const { id } of segments) assert.equal(published[0].get(id), `译文 ${id}`);
});

for (const extraByte of [false, true]) {
  test(`packing counts UTF-8, JSON escapes, IDs and envelope ${extraByte ? "above" : "at"} the byte boundary`, { timeout: 5_000 }, async t => {
    const segments = [segment('first-"\\\n中文', '汉字😀"\\\n\t'.repeat(1_000)), segment("second", "Tail")];
    const payload = () => JSON.stringify({ segments: segments.map(({ id, text }) => ({ id, text })) });
    const padding = 24_000 - Buffer.byteLength(payload(), "utf8");
    assert(padding > 0);
    segments[1].text += "x".repeat(padding + Number(extraByte));
    const provider = await serve(t, reply);
    const translations = new Map<string, string>();
    await translateSegments(segments, { ...settings, endpoint: provider.endpoint }, "", new AbortController().signal, batch => {
      for (const [id, text] of batch) translations.set(id, text);
    });
    assert.equal(provider.requests.length, extraByte ? 2 : 1);
    for (const request of provider.requests) assert(Buffer.byteLength(request.payload, "utf8") <= 24_000);
    assert.deepEqual(new Map(provider.requests.flatMap(request => request.segments).map(({ id, text }) => [id, text])), new Map(segments.map(({ id, text }) => [id, text])));
    assert.deepEqual([...translations.keys()].sort(), segments.map(({ id }) => id).sort());
  });
}

test("an oversized paragraph stays intact in its own request between neighboring batches", { timeout: 5_000 }, async t => {
  const segments = [segment("before", "Before"), segment("oversized", "超长😀\"\\".repeat(5_000)), segment("after", "After")];
  const provider = await serve(t, reply);
  const published = new Map<string, string>();
  await translateSegments(segments, { ...settings, endpoint: provider.endpoint }, "", new AbortController().signal, batch => {
    for (const [id, text] of batch) published.set(id, text);
  });
  assert.equal(provider.requests.length, 3);
  for (const request of provider.requests) assert.equal(request.segments.length, 1);
  assert.deepEqual(new Map(provider.requests.flatMap(request => request.segments).map(({ id, text }) => [id, text])), new Map(segments.map(({ id, text }) => [id, text])));
  const oversized = provider.requests.find(request => request.segments[0].id === "oversized");
  assert(oversized && Buffer.byteLength(oversized.payload, "utf8") > 24_000);
  assert.equal(published.size, 3);
});

test("long documents keep at most three requests active and publish out-of-order completions by ID", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const segments = longDocument();
  const published = new Map<string, string>();
  const order: string[] = [];
  const pending = translateSegments(segments, { ...settings, endpoint: provider.endpoint }, "", new AbortController().signal, batch => {
    for (const [id, text] of batch) {
      published.set(id, text);
      order.push(id);
    }
  });
  await provider.waitForRequests(3);
  assert.equal(provider.active, 3);
  reply(provider.requests[2]);
  await provider.waitForRequests(4);
  reply(provider.requests[1]);
  await provider.waitForRequests(5);
  reply(provider.requests[0]);
  await provider.waitForRequests(6);
  reply(provider.requests[5]);
  await provider.waitForRequests(7);
  for (const index of [6, 4, 3]) reply(provider.requests[index]);
  await pending;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(provider.maxActive, 3);
  assert.equal(provider.active, 0);
  assert.equal(provider.requests.length, segments.length);
  assert.deepEqual(order.slice(0, 3), [provider.requests[2], provider.requests[1], provider.requests[0]].map(request => request.segments[0].id));
  for (const { id } of segments) assert.equal(published.get(id), `译文 ${id}`);
});

test("cancellation aborts in-flight requests and blocks late publication and queued work", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const controller = new AbortController();
  const published: ReadonlyMap<string, string>[] = [];
  const pending = translateSegments(longDocument(), { ...settings, endpoint: provider.endpoint }, "", controller.signal, batch => published.push(batch));
  const rejected = assert.rejects(pending, /cancel/i);
  await provider.waitForRequests(3);
  controller.abort();
  for (const request of provider.requests) reply(request);
  await rejected;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(provider.requests.length, 3);
  assert.equal(provider.active, 0);
  assert.deepEqual(published, []);
});

test("cancellation from publication preserves that batch but starts and publishes no further work", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const controller = new AbortController();
  const published: ReadonlyMap<string, string>[] = [];
  const pending = translateSegments(longDocument(), { ...settings, endpoint: provider.endpoint }, "", controller.signal, batch => {
    published.push(batch);
    controller.abort();
  });
  const rejected = assert.rejects(pending, /cancel/i);
  await provider.waitForRequests(3);
  reply(provider.requests[1]);
  await rejected;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(provider.requests.length, 3);
  assert.equal(provider.active, 0);
  assert.equal(published.length, 1);
  const id = provider.requests[1].segments[0].id;
  assert.equal(published[0].get(id), `译文 ${id}`);
});

test("the first provider error survives sibling cancellation without aborting the caller", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const controller = new AbortController();
  const published: ReadonlyMap<string, string>[] = [];
  const pending = translateSegments(longDocument(), { ...settings, endpoint: provider.endpoint }, "", controller.signal, batch => published.push(batch));
  const rejected = assert.rejects(pending, /HTTP 500/);
  await provider.waitForRequests(3);
  provider.requests[1].response.writeHead(500);
  provider.requests[1].response.end("provider failure");
  await rejected;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(controller.signal.aborted, false);
  assert.equal(provider.requests.length, 3);
  assert.equal(provider.active, 0);
  assert.deepEqual(published, []);
});

test("a publication error is preserved while sibling requests drain", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const controller = new AbortController();
  const failure = new Error("Cannot publish this snapshot");
  let publications = 0;
  const pending = translateSegments(longDocument(), { ...settings, endpoint: provider.endpoint }, "", controller.signal, () => {
    publications++;
    throw failure;
  });
  const rejected = assert.rejects(pending, error => error === failure);
  await provider.waitForRequests(3);
  reply(provider.requests[0]);
  await rejected;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(controller.signal.aborted, false);
  assert.equal(provider.requests.length, 3);
  assert.equal(provider.active, 0);
  assert.equal(publications, 1);
});

test("empty input, duplicate or empty IDs, and pre-cancellation never contact the provider", { timeout: 5_000 }, async t => {
  const provider = await serve(t, reply);
  const configuration = { ...settings, endpoint: provider.endpoint };
  const signal = new AbortController().signal;
  let publications = 0;
  const publish = () => { publications++; };
  await translateSegments([], configuration, "", signal, publish);
  await assert.rejects(translateSegments([segment("", "Source")], configuration, "", signal, publish));
  await assert.rejects(translateSegments([segment(" ", "Source")], configuration, "", signal, publish));
  await assert.rejects(translateSegments([...longDocument(), segment("paragraph-0", "Duplicate")], configuration, "", signal, publish));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(translateSegments([segment("first", "Source")], configuration, "", controller.signal, publish), /cancel/i);
  assert.equal(provider.requests.length, 0);
  assert.equal(publications, 0);
});

test("a later batch failure retains earlier publications and cancels the remaining requests", { timeout: 5_000 }, async t => {
  const provider = await serve(t);
  const controller = new AbortController();
  const published = new Map<string, string>();
  const pending = translateSegments(longDocument(), { ...settings, endpoint: provider.endpoint }, "", controller.signal, batch => {
    for (const [id, text] of batch) published.set(id, text);
  });
  const rejected = assert.rejects(pending, /HTTP 503/);
  await provider.waitForRequests(3);
  const completedId = provider.requests[0].segments[0].id;
  reply(provider.requests[0]);
  await provider.waitForRequests(4);
  provider.requests[1].response.writeHead(503);
  provider.requests[1].response.end("unavailable");
  await rejected;
  await Promise.all(provider.requests.map(request => request.closed));
  assert.equal(controller.signal.aborted, false);
  assert.equal(provider.requests.length, 4);
  assert.equal(provider.active, 0);
  assert.deepEqual([...published], [[completedId, `译文 ${completedId}`]]);
});
