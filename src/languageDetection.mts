import { eld } from "eld/small";
import { Converter, type ConverterFunction } from "opencc-js";
import { resolveTargetLanguage } from "./translationLanguages";

const detector = eld.newInstance();
let toSimplified: ConverterFunction | undefined;
let toTraditional: ConverterFunction | undefined;

const scripts: Readonly<Record<string, RegExp>> = {
  zh: /^\p{Script=Han}+$/u,
  ja: /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u,
  ko: /^[\p{Script=Hangul}\p{Script=Han}]+$/u,
  ru: /^\p{Script=Cyrillic}+$/u,
  uk: /^\p{Script=Cyrillic}+$/u,
  bg: /^\p{Script=Cyrillic}+$/u,
  sr: /^[\p{Script=Cyrillic}\p{Script=Latin}]+$/u,
  el: /^\p{Script=Greek}+$/u,
  ar: /^\p{Script=Arabic}+$/u,
  fa: /^\p{Script=Arabic}+$/u,
  ur: /^\p{Script=Arabic}+$/u,
  he: /^\p{Script=Hebrew}+$/u,
  hi: /^\p{Script=Devanagari}+$/u,
  bn: /^\p{Script=Bengali}+$/u,
  ta: /^\p{Script=Tamil}+$/u,
  te: /^\p{Script=Telugu}+$/u,
  th: /^\p{Script=Thai}+$/u,
};
const latin = /^\p{Script=Latin}+$/u;

const words = new Intl.Segmenter(undefined, { granularity: "word" });

function analyze(text: string) {
  const prose = text.replace(/⟦(?:FORMAT|INLINE_CODE)_\d+⟧/g, " ").trim();
  let sample = prose.replace(/\b[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)+\b/gu, " ");
  let result = detector.detect(sample);
  if (!result.isReliable()) {
    const terms = sample.match(/\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}_-]*/gu) ?? [];
    const native = sample.replace(/\p{Script=Latin}[\p{Script=Latin}\p{M}\p{N}_-]*/gu, " ");
    if ((native.match(/\p{L}/gu)?.length ?? 0) > terms.length) {
      sample = native;
      result = detector.detect(sample);
    }
  }
  let weight = 0;
  for (const segment of words.segment(sample)) {
    if (segment.isWordLike && /\p{L}/u.test(segment.segment)) weight++;
  }
  return { text, prose, weight, letters: sample.replace(/[^\p{L}]/gu, ""), language: result.isReliable() ? result.language : undefined };
}

export function findTargetLanguageTexts(texts: readonly string[], targetLanguage: string): ReadonlySet<string> {
  const matches = new Set<string>();
  const target = resolveTargetLanguage(targetLanguage)?.code;
  if (!target) return matches;
  const language = target.startsWith("zh-") ? "zh" : target === "nb" ? "no" : target;
  const paragraphs = texts.map(analyze);
  let targetWeight = 0;
  let total = 0;
  for (const paragraph of paragraphs) {
    total += paragraph.weight;
    if (paragraph.language === language) targetWeight += paragraph.weight;
  }
  const contextMatches = targetWeight > total / 2;
  for (const paragraph of paragraphs) {
    if (paragraph.language ? paragraph.language !== language
      : !contextMatches || !(scripts[language] ?? latin).test(paragraph.letters)) continue;
    if (target === "zh-CN") {
      toSimplified ??= Converter({ from: "tw", to: "cn" });
      if (toSimplified(paragraph.prose) !== paragraph.prose) continue;
    } else if (target === "zh-TW") {
      toTraditional ??= Converter({ from: "cn", to: "tw" });
      if (toTraditional(paragraph.prose) !== paragraph.prose) continue;
    }
    matches.add(paragraph.text);
  }
  return matches;
}
