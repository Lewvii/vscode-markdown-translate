import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { translateFreeSegments } from "../src/freeTranslation";
import type { TranslationSegment } from "../src/translation";
import { resolveTargetLanguage } from "../src/translationLanguages";

const source: readonly TranslationSegment[] = [{ id: "first", text: "Read the documentation.", markers: [] }];

function mockFetch(t: TestContext, handler: (url: URL, init: RequestInit) => Promise<Response>): void {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://translate.googleapis.com");
    assert.equal(url.pathname, "/translate_a/single");
    assert(init);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("authorization"), null);
    assert.equal(init.body, undefined);
    assert(init.signal);
    return handler(url, init);
  });
}

test("uses the fixed free endpoint and canonical target without credentials", async t => {
  const batches: ReadonlyMap<string, string>[] = [];
  mockFetch(t, async url => {
    assert.deepEqual([...url.searchParams.keys()].sort(), ["client", "dt", "q", "sl", "tl"]);
    assert.equal(url.searchParams.get("client"), "gtx");
    assert.equal(url.searchParams.get("sl"), "auto");
    assert.equal(url.searchParams.get("dt"), "t");
    assert.equal(url.searchParams.get("tl"), resolveTargetLanguage("简体中文")?.code);
    assert.equal(url.searchParams.get("q"), "Read the documentation.");
    return Response.json([[["阅读", "Read", null, null, 10], ["文档。", "the documentation."]], null, "en"]);
  });
  await translateFreeSegments(source, "简体中文", new AbortController().signal, batch => batches.push(batch));
  assert.deepEqual(batches, [new Map([["first", "阅读文档。"]])]);
});

test("keeps code and formatting markers local and preserves surrounding whitespace", async t => {
  const segment = {
    id: "paragraph",
    text: " \tRead ⟦FORMAT_0⟧the guide⟦FORMAT_1⟧ and ⟦INLINE_CODE_0⟧.\r\n  Next\tline  ",
    markers: ["⟦FORMAT_0⟧", "⟦FORMAT_1⟧", "⟦INLINE_CODE_0⟧"],
    formatting: "private-code() https://private.example/link",
  };
  const dictionary: Record<string, string | undefined> = { Read: "阅读", "the guide": "指南", and: "和", ".": "。", Next: "下一", line: "行" };
  const requests: string[] = [];
  let translated = "";
  mockFetch(t, async url => {
    const text = url.searchParams.get("q");
    assert(text);
    assert(!/[⟦⟧]|FORMAT|INLINE_CODE|private/.test(url.href));
    requests.push(text);
    const value = dictionary[text];
    assert(value);
    return Response.json([[[` ${value} `]]]);
  });
  await translateFreeSegments([segment], "zh-CN", new AbortController().signal, batch => {
    translated = batch.get("paragraph") ?? "";
  });
  assert.deepEqual(requests, ["Read", "the guide", "and", ".", "Next", "line"]);
  assert.equal(translated, " \t阅读 ⟦FORMAT_0⟧指南⟦FORMAT_1⟧ 和 ⟦INLINE_CODE_0⟧。\r\n  下一\t行  ");
});

test("preserves marker-only segments without contacting Google", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  const batches: ReadonlyMap<string, string>[] = [];
  const segment = { id: "code", text: " ⟦INLINE_CODE_0⟧ ", markers: ["⟦INLINE_CODE_0⟧"] };
  await translateFreeSegments([segment], "en", new AbortController().signal, batch => batches.push(batch));
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(batches, [new Map([["code", segment.text]])]);
});

for (const text of ["word ".repeat(1_000), "😀汉é".repeat(1_001), "a".repeat(1_499) + "😀" + "z".repeat(1_501)]) {
  test(`translates every character of a ${Buffer.byteLength(text, "utf8")}-byte segment in bounded Unicode-safe requests`, async t => {
    const requested: string[] = [];
    const batches: ReadonlyMap<string, string>[] = [];
    mockFetch(t, async url => {
      const chunk = url.searchParams.get("q");
      assert(chunk);
      assert(Buffer.byteLength(chunk, "utf8") <= 1_500);
      assert(!chunk.includes("\uFFFD"));
      assert(url.href.length < 5_000);
      requested.push(chunk);
      return Response.json([[[chunk]]]);
    });
    await translateFreeSegments([{ id: "long", text, markers: [] }], "en", new AbortController().signal, batch => batches.push(batch));
    assert(requested.length > 1);
    assert.deepEqual(batches, [new Map([["long", text]])]);
  });
}

const invalidSegments: { name: string; segment: TranslationSegment }[] = [
  { name: "missing marker", segment: { id: "one", text: "Read this", markers: ["⟦INLINE_CODE_0⟧"] } },
  { name: "undeclared marker", segment: { id: "one", text: "Read ⟦INLINE_CODE_0⟧", markers: [] } },
  { name: "reordered markers", segment: { id: "one", text: "⟦FORMAT_1⟧Read⟦FORMAT_0⟧", markers: ["⟦FORMAT_0⟧", "⟦FORMAT_1⟧"] } },
  { name: "duplicate markers", segment: { id: "one", text: "⟦FORMAT_0⟧Read⟦FORMAT_0⟧", markers: ["⟦FORMAT_0⟧", "⟦FORMAT_0⟧"] } },
  { name: "unknown marker", segment: { id: "one", text: "Read ⟦SECRET_0⟧", markers: ["⟦SECRET_0⟧"] } },
  { name: "unclosed marker", segment: { id: "one", text: "Read ⟦INLINE_CODE_0", markers: [] } },
  { name: "stray marker bracket", segment: { id: "one", text: "Read ⟧", markers: [] } },
  { name: "nested marker", segment: { id: "one", text: "Read ⟦⟦INLINE_CODE_0⟧⟧", markers: ["⟦INLINE_CODE_0⟧"] } },
  { name: "blank ID", segment: { id: " ", text: "Read", markers: [] } },
  { name: "blank text", segment: { id: "one", text: " \t ", markers: [] } },
  { name: "unpaired high surrogate", segment: { id: "one", text: "Read \uD800", markers: [] } },
  { name: "unpaired low surrogate", segment: { id: "one", text: "Read \uDC00", markers: [] } },
];
for (const { name, segment } of invalidSegments) {
  test(`rejects ${name} before any network request or publication`, async t => {
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
    let published = false;
    await assert.rejects(translateFreeSegments([...source, segment], "en", new AbortController().signal, () => { published = true; }));
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(published, false);
  });
}

test("rejects duplicate IDs and unsupported targets without sending text", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  await assert.rejects(translateFreeSegments([...source, ...source], "en", new AbortController().signal, () => assert.fail("published")));
  await assert.rejects(translateFreeSegments(source, "private-custom-language", new AbortController().signal, () => assert.fail("published")));
  assert.equal(fetch.mock.callCount(), 0);
});

const invalidResponses: { name: string; body: unknown }[] = [
  { name: "null response", body: null },
  { name: "object response", body: { translation: "private-provider-body" } },
  { name: "empty response", body: [] },
  { name: "missing sentences", body: [null] },
  { name: "empty sentences", body: [[]] },
  { name: "non-array sentence", body: [["private-provider-body"]] },
  { name: "null sentence", body: [[null]] },
  { name: "missing translated text", body: [[[]]] },
  { name: "non-string translated text", body: [[[42]]] },
  { name: "empty translated text", body: [[[""]]] },
  { name: "whitespace translated text", body: [[[" \n "]]] },
  { name: "partially invalid sentences", body: [[["valid"], [null]]] },
  { name: "injected code marker", body: [[["text ⟦INLINE_CODE_0⟧"]]] },
  { name: "injected format marker", body: [[["text ⟦FORMAT_0⟧"]]] },
  { name: "injected incomplete marker", body: [[["text ⟦"]]] },
];
for (const { name, body } of invalidResponses) {
  test(`rejects ${name} without publishing or exposing provider content`, async t => {
    mockFetch(t, async () => Response.json(body));
    await assert.rejects(translateFreeSegments(source, "en", new AbortController().signal, () => assert.fail("published")), error => {
      assert(error instanceof Error);
      assert(!/private-provider-body|Read the documentation|https?:|INLINE_CODE|FORMAT/.test(error.message));
      return true;
    });
  });
}

for (const status of [302, 401, 403, 429, 500]) {
  test(`sanitizes HTTP ${status} without retrying`, async t => {
    let requests = 0;
    mockFetch(t, async () => {
      requests++;
      return new Response("private-body key-123 Read the documentation https://private.example", { status });
    });
    await assert.rejects(translateFreeSegments(source, "en", new AbortController().signal, () => assert.fail("published")), error => {
      assert(error instanceof Error);
      assert(!/private|key-123|Read the documentation|https?:/.test(error.message));
      return true;
    });
    assert.equal(requests, 1);
  });
}

test("sanitizes rejected fetch and malformed JSON errors", async t => {
  let requests = 0;
  mockFetch(t, async () => {
    if (++requests === 1) throw new Error("private-key https://private.example Read the documentation");
    return new Response("private-key https://private.example Read the documentation");
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(translateFreeSegments(source, "en", new AbortController().signal, () => assert.fail("published")), error => {
      assert(error instanceof Error);
      assert(!/private|Read the documentation|https?:/.test(error.message));
      return true;
    });
  }
  assert.equal(requests, 2);
});

test("runs at most three HTTP requests and publishes each complete segment once", async t => {
  let active = 0;
  let peak = 0;
  const segments = Array.from({ length: 9 }, (_, index) => ({ id: `id-${index}`, text: `Source ${index}`, markers: [] }));
  const published = new Map<string, string>();
  mockFetch(t, async url => {
    active++;
    peak = Math.max(peak, active);
    await setImmediate();
    active--;
    return Response.json([[[`Translation ${url.searchParams.get("q")}`]]]);
  });
  await translateFreeSegments(segments, "en", new AbortController().signal, batch => {
    assert.equal(batch.size, 1);
    for (const [id, text] of batch) {
      assert(!published.has(id));
      published.set(id, text);
    }
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(published, new Map(segments.map(segment => [segment.id, `Translation ${segment.text}`])));
});

test("keeps completed segments and aborts and drains in-flight requests on failure", { timeout: 5_000 }, async t => {
  const events = new EventEmitter();
  const completed = once(events, "published");
  const requests: string[] = [];
  const published: ReadonlyMap<string, string>[] = [];
  let active = 0;
  mockFetch(t, async (url, init) => {
    const text = url.searchParams.get("q");
    assert(text);
    requests.push(text);
    if (text === "first") return Response.json([[["第一"]]]);
    active++;
    assert(init.signal);
    try {
      const [response]: unknown[] = await once(events, text, { signal: init.signal });
      assert(response instanceof Response);
      return response;
    } finally {
      active--;
    }
  });
  const segments = ["first", "second", "third", "fourth", "queued"].map(id => ({ id, text: id, markers: [] }));
  const pending = translateFreeSegments(segments, "en", new AbortController().signal, batch => {
    published.push(batch);
    events.emit("published");
  });
  await completed;
  events.emit("second", new Response("private body", { status: 429 }));
  await assert.rejects(pending, /rate limit/i);
  assert.equal(active, 0);
  assert.deepEqual(requests, ["first", "second", "third", "fourth"]);
  assert.deepEqual(published, [new Map([["first", "第一"]])]);
});

test("cancellation drains requests and does not publish partial or queued segments", { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const events = new EventEmitter();
  const started = once(events, "started");
  let active = 0;
  let requests = 0;
  mockFetch(t, async (_url, init) => {
    active++;
    requests++;
    assert(init.signal);
    const aborted = once(init.signal, "abort");
    if (requests === 3) events.emit("started");
    await aborted;
    active--;
    throw new Error("private abort details");
  });
  const segments = Array.from({ length: 6 }, (_, index) => ({ id: `${index}`, text: `Source ${index}`, markers: [] }));
  const pending = translateFreeSegments(segments, "en", controller.signal, () => assert.fail("published after cancellation"));
  await started;
  controller.abort(new Error("private abort reason"));
  await assert.rejects(pending, /cancel/i);
  assert.equal(active, 0);
  assert.equal(requests, 3);
});

test("does not publish a partially translated long segment if a later chunk fails", async t => {
  let requests = 0;
  mockFetch(t, async () => {
    if (++requests === 1) return Response.json([[["部分"]]]);
    return new Response("private provider body", { status: 500 });
  });
  await assert.rejects(translateFreeSegments([{ id: "long", text: "a".repeat(4_000), markers: [] }], "en", new AbortController().signal, () => assert.fail("partial segment published")), /HTTP 500/);
  assert.equal(requests, 2);
});

test("empty work and pre-cancelled work never contact Google", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected request"); });
  const controller = new AbortController();
  await translateFreeSegments([], "en", controller.signal, () => assert.fail("published"));
  controller.abort();
  await assert.rejects(translateFreeSegments(source, "en", controller.signal, () => assert.fail("published")), /cancel/i);
  assert.equal(fetch.mock.callCount(), 0);
});

test("cancellation from publication preserves that segment and blocks queued and late results", { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const events = new EventEmitter();
  const published = once(events, "published");
  const late = once(events, "late");
  let requests = 0;
  const batches: ReadonlyMap<string, string>[] = [];
  mockFetch(t, async () => {
    if (++requests === 1) return Response.json([[["第一"]]]);
    await late;
    return Response.json([[["迟到"]]]);
  });
  const segments = ["first", "second", "third", "queued"].map(id => ({ id, text: id, markers: [] }));
  const pending = translateFreeSegments(segments, "en", controller.signal, batch => {
    batches.push(batch);
    controller.abort();
    events.emit("published");
  });
  await published;
  events.emit("late");
  await assert.rejects(pending, /cancel/i);
  assert.equal(requests, 3);
  assert.deepEqual(batches, [new Map([["first", "第一"]])]);
});

test("does not exceed the byte bound after a short whitespace prefix and long Unicode word", async t => {
  const text = "a " + "x".repeat(1_497) + "😀" + "y".repeat(1_501);
  let translated = "";
  mockFetch(t, async url => {
    const chunk = url.searchParams.get("q");
    assert(chunk);
    assert(Buffer.byteLength(chunk, "utf8") <= 1_500);
    return Response.json([[[chunk]]]);
  });
  await translateFreeSegments([{ id: "long", text, markers: [] }], "en", new AbortController().signal, batch => {
    translated = batch.get("long") ?? "";
  });
  assert.equal(translated, text);
});
