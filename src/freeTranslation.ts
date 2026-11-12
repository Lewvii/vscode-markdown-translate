import type { TranslationSegment } from "./translation";
import { resolveTargetLanguage } from "./translationLanguages";

const MAX_CHUNK_BYTES = 1_500;
const MAX_CONCURRENT_SEGMENTS = 3;
const markerPattern = /⟦(?:INLINE_CODE|FORMAT)_\d+⟧/g;

type TextPart = { kind: "local" | "prose"; text: string };

function prepareSegments(segments: readonly TranslationSegment[]): { id: string; parts: TextPart[] }[] {
  const ids = new Set<string>();
  return segments.map(segment => {
    if (!segment.id.trim() || ids.has(segment.id)) throw new Error("Translation segment IDs must be nonempty and unique.");
    ids.add(segment.id);
    if (!segment.text.trim()) throw new Error("The document is empty. There is nothing to translate.");
    const actual = segment.text.match(markerPattern) ?? [];
    if (actual.length !== segment.markers.length
      || actual.some((marker, index) => marker !== segment.markers[index])
      || new Set(actual).size !== actual.length
      || /[⟦⟧]/.test(segment.text.replace(markerPattern, ""))) {
      throw new Error("The translation segment has invalid formatting markers.");
    }
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(segment.text)) {
      throw new Error("The translation segment contains invalid Unicode text.");
    }
    const parts: TextPart[] = [];
    let start = 0;
    for (const match of segment.text.matchAll(/⟦(?:INLINE_CODE|FORMAT)_\d+⟧|[^\S ]+| {2,}/g)) {
      if (match.index > start) parts.push({ kind: "prose", text: segment.text.slice(start, match.index) });
      parts.push({ kind: "local", text: match[0] });
      start = match.index + match[0].length;
    }
    if (start < segment.text.length) parts.push({ kind: "prose", text: segment.text.slice(start) });
    return { id: segment.id, parts };
  });
}

function* chunks(text: string): Generator<string> {
  let start = 0;
  let end = 0;
  let bytes = 0;
  let boundary = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    while (bytes + size > MAX_CHUNK_BYTES) {
      const split = boundary > start ? boundary : end;
      yield text.slice(start, split);
      start = split;
      bytes = Buffer.byteLength(text.slice(start, end), "utf8");
    }
    end += character.length;
    bytes += size;
    if (/\s/u.test(character)) boundary = end;
  }
  if (start < text.length) yield text.slice(start);
}

function parseTranslation(value: unknown): string {
  if (!Array.isArray(value) || !Array.isArray(value[0]) || value[0].length === 0) {
    throw new Error("The free translation service returned an incompatible response format.");
  }
  const sentences: unknown[] = value[0];
  const translated: string[] = [];
  for (const sentence of sentences) {
    if (!Array.isArray(sentence) || typeof sentence[0] !== "string" || !sentence[0].trim()) {
      throw new Error("The free translation service returned an invalid or empty translation.");
    }
    translated.push(sentence[0]);
  }
  const text = translated.join("").trim();
  if (/[⟦⟧]/.test(text)) throw new Error("The free translation service returned unexpected formatting markers.");
  return text;
}

async function translateChunk(text: string, language: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error("Translation cancelled.");
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.search = new URLSearchParams({ client: "gtx", sl: "auto", tl: language, dt: "t", q: text }).toString();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 90_000);
  try {
    let response: Response;
    try {
      response = await fetch(url, { method: "GET", redirect: "error", signal: controller.signal });
    } catch {
      throw new Error("Cannot connect to the free translation service. Check the network and service status. Redirects are not allowed.");
    }
    if (!response.ok) {
      controller.abort();
      if (response.status === 429) throw new Error("The free translation service rate limit was exceeded. Try again manually later.");
      if (response.status === 401 || response.status === 403) throw new Error("Access to the free translation service was denied. Try again manually later.");
      throw new Error(`The free translation service returned HTTP ${response.status}. Try again manually later.`);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("The free translation service did not return valid JSON.");
    }
    return parseTranslation(value);
  } catch (error) {
    if (signal.aborted) throw new Error("Translation cancelled.");
    if (timedOut) throw new Error("The free translation request timed out. Try again manually later.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

export async function translateFreeSegments(
  segments: readonly TranslationSegment[],
  targetLanguage: string,
  signal: AbortSignal,
  onBatch: (translations: ReadonlyMap<string, string>) => void,
): Promise<void> {
  if (signal.aborted) throw new Error("Translation cancelled.");
  if (segments.length === 0) return;
  const language = resolveTargetLanguage(targetLanguage);
  if (!language) throw new Error("Free translation does not support this target language. Choose a language from the list or switch to AI translation.");
  const prepared = prepareSegments(segments);
  const queue = prepared.values();
  const controller = new AbortController();
  let failure: { error: unknown } | undefined;
  const stop = (error: unknown) => {
    if (controller.signal.aborted) return;
    failure = { error };
    controller.abort();
  };
  const cancel = () => stop(new Error("Translation cancelled."));
  signal.addEventListener("abort", cancel, { once: true });
  const worker = async () => {
    try {
      while (!controller.signal.aborted) {
        const next = queue.next();
        if (next.done) return;
        const translated: string[] = [];
        for (const part of next.value.parts) {
          if (controller.signal.aborted) return;
          if (part.kind === "local") {
            translated.push(part.text);
            continue;
          }
          for (const chunk of chunks(part.text)) {
            if (controller.signal.aborted) return;
            const prose = chunk.trim();
            if (!prose) {
              translated.push(chunk);
              continue;
            }
            const leading = chunk.slice(0, chunk.length - chunk.trimStart().length);
            const trailing = chunk.slice(chunk.trimEnd().length);
            translated.push(leading + await translateChunk(prose, language.code, controller.signal) + trailing);
          }
        }
        if (controller.signal.aborted) return;
        onBatch(new Map([[next.value.id, translated.join("")]]));
      }
    } catch (error) {
      stop(error);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SEGMENTS, prepared.length) }, worker));
    if (failure) throw failure.error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
