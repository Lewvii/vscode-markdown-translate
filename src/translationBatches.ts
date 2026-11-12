import { translateBatch, type TranslationSegment, type TranslationSettings } from "./translation";

const MAX_BATCH_BYTES = 24_000;
const MAX_CONCURRENT_BATCHES = 3;
const ENVELOPE_BYTES = Buffer.byteLength('{"segments":[]}', "utf8");

export async function translateSegments(
  segments: readonly TranslationSegment[],
  settings: TranslationSettings,
  apiKey: string,
  signal: AbortSignal,
  onBatch: (translations: ReadonlyMap<string, string>) => void,
): Promise<void> {
  if (signal.aborted) throw new Error("Translation cancelled.");
  const batches: TranslationSegment[][] = [];
  const ids = new Set<string>();
  let batch: TranslationSegment[] = [];
  let bytes = ENVELOPE_BYTES;
  for (const segment of segments) {
    if (!segment.id.trim() || ids.has(segment.id)) throw new Error("Translation segment IDs must be nonempty and unique.");
    ids.add(segment.id);
    const segmentBytes = Buffer.byteLength(JSON.stringify({ id: segment.id, text: segment.text }), "utf8");
    if (batch.length > 0 && bytes + 1 + segmentBytes > MAX_BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      bytes = ENVELOPE_BYTES;
    }
    bytes += (batch.length > 0 ? 1 : 0) + segmentBytes;
    batch.push(segment);
  }
  if (batch.length > 0) batches.push(batch);
  if (batches.length === 0) return;

  const controller = new AbortController();
  let failure: { error: unknown } | undefined;
  const stop = (error: unknown) => {
    if (controller.signal.aborted) return;
    failure = { error };
    controller.abort();
  };
  const cancel = () => stop(new Error("Translation cancelled."));
  signal.addEventListener("abort", cancel, { once: true });
  const queue = batches.values();
  const worker = async () => {
    try {
      while (!controller.signal.aborted) {
        const next = queue.next();
        if (next.done) return;
        const translations = await translateBatch(next.value, settings, apiKey, controller.signal);
        if (controller.signal.aborted) return;
        onBatch(translations);
      }
    } catch (error) {
      stop(error);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) }, worker));
    if (failure) throw failure.error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
