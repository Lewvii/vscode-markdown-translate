import assert from "node:assert/strict";
import test from "node:test";
const detection = import("../src/languageDetection.mjs");

const simplified = "这是一个中文文档。请按照说明完成安装和配置。";
const traditional = "這是一份繁體中文文件，請按照說明完成安裝與設定。";
const english = "This document explains how to install and configure the extension.";
const french = "Ce document explique comment installer et configurer cette extension.";
const japanese = "日本語の文章を中国語に翻訳してください。";

test("recognizes matching target language codes and aliases", async () => {
  const { findTargetLanguageTexts } = await detection;
  for (const target of ["zh-CN", "简体中文", "Chinese (Simplified)"]) {
    assert.deepEqual([...findTargetLanguageTexts([simplified], target)], [simplified]);
  }
});

test("skips dominant target languages across scripts despite foreign terms", async () => {
  const { findTargetLanguageTexts } = await detection;
  const cases = [
    ["zh-CN", "请运行 install，然后检查 configuration。"],
    ["zh-CN", "这是中文说明，使用 API 和 HTTP。"],
    ["zh-CN", "在 VS Code 中打开 README.md 文件，然后运行 npm install 安装依赖。"],
    ["zh-TW", "這是中文說明，使用 API 和 HTTP。"],
    ["en", "This English sentence contains 中文 as a product label."],
    ["en", `${english} 你好`],
    ["fr", "Veuillez exécuter npm install, puis vérifier la configuration."],
    ["de", "Führen Sie npm install aus und prüfen Sie anschließend die configuration."],
    ["es", "Ejecute npm install y compruebe la configuración."],
    ["ja", "VS Code で README.md を開いてください。"],
    ["ko", "VS Code에서 README.md 파일을 여세요."],
    ["ar", "افتح الملف في VS Code ثم تحقق من إعدادات التطبيق قبل المتابعة."],
  ];
  for (const [target, text] of cases) {
    assert.deepEqual([...findTargetLanguageTexts([text], target)], [text], target);
    assert.equal(findTargetLanguageTexts([text], target === "en" ? "zh-CN" : "en").size, 0, target);
  }
});

test("uses reliable document prose for short headings and technical paragraphs", async () => {
  const { findTargetLanguageTexts } = await detection;
  const texts = [
    "磁盘启动",
    "构建",
    "base、app、mode 和 rollback 由 gateway 上的 srota 管理，GRUB 只加载启动资源。",
    "静态 ⟦INLINE_CODE_0⟧ 只用于 SRC2500 logic 的开发/恢复场景；生产配置由 srota 发布。",
    "磁盘 EFI 查找 ⟦INLINE_CODE_0⟧，加载本地 kernel、initramfs 和 rootfs：",
  ];
  assert.deepEqual([...findTargetLanguageTexts(texts, "zh-CN")], texts);
  assert.deepEqual([...findTargetLanguageTexts([...texts, "API", "Read the documentation."], "zh-CN")], texts);
  assert.equal(findTargetLanguageTexts(texts, "en").size, 0);
  assert.equal(findTargetLanguageTexts(texts, "zh-TW").size, 0);
});

test("context cannot override reliable foreign prose or incompatible scripts", async () => {
  const { findTargetLanguageTexts } = await detection;
  const texts = [simplified.repeat(8), "磁盘启动", japanese, english, "API", "Install"];
  assert.deepEqual([...findTargetLanguageTexts(texts, "zh-CN")], texts.slice(0, 2));
  assert.equal(findTargetLanguageTexts([english.repeat(8), "磁盘启动"], "en").has("磁盘启动"), false);
  assert.equal(findTargetLanguageTexts([japanese.repeat(8), "磁盘启动"], "zh-CN").has("磁盘启动"), false);
  assert.equal(findTargetLanguageTexts([english, french, "API"], "en").has("API"), false);
});

test("context works for non-Chinese headings without changing other paragraphs", async () => {
  const { findTargetLanguageTexts } = await detection;
  for (const [prose, heading, target] of [
    [english, "Setup", "en"],
    [french, "API", "fr"],
    [japanese, "設定", "ja"],
  ]) {
    assert.deepEqual([...findTargetLanguageTexts([prose, heading], target)], [prose, heading]);
  }
});

test("preserves simplified and traditional conversion requirements", async () => {
  const { findTargetLanguageTexts } = await detection;
  assert.deepEqual([...findTargetLanguageTexts([traditional], "zh-TW")], [traditional]);
  assert.equal(findTargetLanguageTexts([traditional], "zh-CN").size, 0);
  assert.equal(findTargetLanguageTexts([simplified], "zh-TW").size, 0);
});

test("ignores protected formatting and inline code markers", async () => {
  const { findTargetLanguageTexts } = await detection;
  const text = "这是⟦FORMAT_0⟧中文文档⟦FORMAT_1⟧，请按照说明执行⟦INLINE_CODE_0⟧完成安装。";
  assert.deepEqual([...findTargetLanguageTexts([text], "zh-CN")], [text]);
});

test("does not invent a context for ambiguous standalone text or custom languages", async () => {
  const { findTargetLanguageTexts } = await detection;
  for (const text of ["API", "安装", "12345", "", "⟦INLINE_CODE_0⟧", "请 install。"]) {
    assert.equal(findTargetLanguageTexts([text], "zh-CN").size, 0, text);
  }
  assert.equal(findTargetLanguageTexts([english], "Klingon").size, 0);
  assert.equal(findTargetLanguageTexts([`${english} ${french}`], "en").size, 0);
});
