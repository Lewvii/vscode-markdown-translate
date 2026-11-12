import assert from "node:assert/strict";
import test from "node:test";
import MarkdownIt from "markdown-it";
import Token from "markdown-it/lib/token.mjs";
import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import { extendMarkdownIt, preservesFormatting, type Paragraph } from "../src/paragraphs";

function sourceUri(value = "file:///notes.md"): { toString(): string } {
  return { toString: () => value };
}

function elements(node: DefaultTreeAdapterMap["node"], tagName?: string): DefaultTreeAdapterMap["element"][] {
  const found: DefaultTreeAdapterMap["element"][] = [];
  if ("tagName" in node && (!tagName || node.tagName === tagName)) found.push(node);
  if ("childNodes" in node) {
    for (const child of node.childNodes) found.push(...elements(child, tagName));
  }
  return found;
}

function textContent(node: DefaultTreeAdapterMap["node"]): string {
  if ("value" in node) return node.value;
  return "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

function translatedElements(html: string): DefaultTreeAdapterMap["element"][] {
  return elements(parseFragment(html)).filter(node => node.attrs.some(attribute => attribute.name === "class" && attribute.value.split(/\s+/).includes("translation-review-translation")));
}

function markdownWithPlugins(): MarkdownIt {
  const md = new MarkdownIt({ html: true });
  md.inline.ruler.before("escape", "sample_math", (state, silent) => {
    if (state.src[state.pos] !== "$") return false;
    const end = state.src.indexOf("$", state.pos + 1);
    if (end === -1) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before("fence", "sample_math_block", (state, startLine, _endLine, silent) => {
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    if (!line.startsWith("$$") || !line.endsWith("$$") || line.length < 4) return false;
    if (silent) return true;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.map = [startLine, startLine + 1];
    token.content = line.slice(2, -2);
    state.line = startLine + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, index) => `<math>${md.utils.escapeHtml(tokens[index].content)}</math>`;
  md.renderer.rules.math_block = (tokens, index) => `<math display="block">${md.utils.escapeHtml(tokens[index].content)}</math>\n`;
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    if (tokens[index].info.trim() === "mermaid") return `<svg data-diagram="true"><text>${md.utils.escapeHtml(tokens[index].content)}</text></svg>\n`;
    return fence ? fence(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };
  return md;
}

test("delegates native rendering byte for byte when there are no results", () => {
  const source = [
    "# Native heading",
    "",
    "English **prose** with ![Image alt](picture.svg) and `inlineCode` and $formulaWord$.",
    "",
    "<svg><text><tspan>Original SVG</tspan></text></svg>",
    "",
    "```js",
    "const originalCode = '<img>';",
    "```",
    "",
    "```mermaid",
    "graph LR; A[Original diagram] --> B",
    "```",
    "",
    "$$originalBlockFormula$$",
    "",
    "    originalIndentedCode()",
  ].join("\n");
  const md = markdownWithPlugins();
  const tokens = md.parse(source, { currentDocument: undefined });
  const env = { currentDocument: sourceUri() };
  const native = md.renderer.render(tokens, md.options, env);
  const nativeTokens = JSON.stringify(tokens);
  const imageRule = md.renderer.rules.image;
  const htmlRule = md.renderer.rules.html_inline;
  const mathRule = md.renderer.rules.math_inline;
  const fenceRule = md.renderer.rules.fence;
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  assert.equal(md.renderer.render(tokens, md.options, env), native);
  assert.equal(JSON.stringify(tokens), nativeTokens);
  assert.equal(md.renderer.rules.image, imageRule);
  assert.equal(md.renderer.rules.html_inline, htmlRule);
  assert.equal(md.renderer.rules.math_inline, mathRule);
  assert.equal(md.renderer.rules.fence, fenceRule);
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Native heading"]);
});

test("captures the render document rather than the parse environment or cached tokens", () => {
  const md = new MarkdownIt({ html: true });
  const calls: string[] = [];
  extendMarkdownIt(md, (uri, paragraphs) => {
    calls.push(uri);
    return new Map(paragraphs.map(paragraph => [paragraph.id, uri.endsWith("a.md") ? "甲" : "乙"]));
  });
  const tokens = md.parse("Same English paragraph.", { currentDocument: undefined });
  assert.deepEqual(calls, []);
  const before = JSON.stringify(tokens);
  assert.match(md.renderer.render(tokens, md.options, { currentDocument: sourceUri("file:///a.md") }), /甲/);
  assert.match(md.renderer.render(tokens, md.options, { currentDocument: sourceUri("file:///b.md") }), /乙/);
  assert.deepEqual(calls, ["file:///a.md", "file:///b.md"]);
  assert.equal(JSON.stringify(tokens), before);
});

test("missing or malformed document identity leaves native output untouched", () => {
  const md = new MarkdownIt({ html: true });
  const native = md.render("Original English.");
  extendMarkdownIt(md, () => assert.fail("No source document means no translation lookup"));
  for (const env of [undefined, null, {}, { currentDocument: undefined }, { currentDocument: "file:///notes.md" }, { currentDocument: {} }, { currentDocument: { toString: () => 42 } }]) {
    assert.equal(md.render("Original English.", env), native);
  }
});

test("keeps duplicate blocks distinct and places out of order results by identity", () => {
  const md = new MarkdownIt({ html: true });
  const snapshots: (readonly Paragraph[])[] = [];
  let translations: ReadonlyMap<string, string> | undefined;
  extendMarkdownIt(md, (_uri, paragraphs) => {
    snapshots.push(paragraphs);
    return translations;
  });
  const env = { currentDocument: sourceUri() };
  const tokens = md.parse("Repeat paragraph.\n\nRepeat paragraph.\n\nFinal paragraph.", {});
  const native = md.renderer.render(tokens, md.options, env);
  const paragraphs = snapshots[0];
  assert.equal(new Set(paragraphs.map(paragraph => paragraph.id)).size, 3);
  translations = new Map([[paragraphs[2].id, "末段"], ["foreign-id", "不应出现"], [paragraphs[1].id, "第二段"], [paragraphs[0].id, "第一段"]]);
  const translated = md.renderer.render(tokens, md.options, env);
  assert.deepEqual(elements(parseFragment(translated), "p").map(textContent), ["Repeat paragraph. 第一段", "Repeat paragraph. 第二段", "Final paragraph. 末段"]);
  assert.deepEqual(translatedElements(translated).map(textContent), ["第一段", "第二段", "末段"]);
  assert.equal(md.renderer.render(tokens, md.options, env), translated);
  assert.deepEqual(snapshots[1], snapshots[0]);
  const refreshed = md.parse("Repeat paragraph.\n\nRepeat paragraph.\n\nFinal paragraph.", {});
  assert.equal(md.renderer.render(refreshed, md.options, env), translated);
  translations = undefined;
  assert.equal(md.renderer.render(tokens, md.options, env), native);
});

test("preserves inline code as escaped code in Chinese without sending it to the service", () => {
  const md = markdownWithPlugins();
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, "阅读 ⟦INLINE_CODE_0⟧ 和 ⟦INLINE_CODE_1⟧，然后阅读 ⟦FORMAT_0⟧指南⟦FORMAT_1⟧。"]));
  });
  const source = "Read ![secret alt **words**](https://images.example/pic.svg) the `secretCode` and `otherCode` then [guide](https://docs.example/private) at https://private.example/secret or <https://auto.example/private>.";
  const native = markdownWithPlugins().render(source);
  const html = md.render(source, { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Read the ⟦INLINE_CODE_0⟧ and ⟦INLINE_CODE_1⟧ then ⟦FORMAT_0⟧guide⟦FORMAT_1⟧ at or ."]);
  assert.deepEqual(captured[0].markers, ["⟦INLINE_CODE_0⟧", "⟦INLINE_CODE_1⟧", "⟦FORMAT_0⟧", "⟦FORMAT_1⟧"]);
  assert.equal(html, native + '<p class="translation-review-translation">阅读 <code>secretCode</code> 和 <code>otherCode</code>，然后阅读 <a href="https://docs.example/private">指南</a>。</p>\n');
  assert.doesNotMatch(captured[0].text, /secretCode|otherCode|https|example|pic\.svg/);
});

test("rejects missing, duplicated or reordered code markers rather than losing code", () => {
  const markers = ["⟦INLINE_CODE_0⟧", "⟦INLINE_CODE_1⟧"];
  assert.equal(preservesFormatting(markers, "先 ⟦INLINE_CODE_0⟧，后 ⟦INLINE_CODE_1⟧"), true);
  for (const translation of ["没有标记", "⟦INLINE_CODE_0⟧", "⟦INLINE_CODE_0⟧ ⟦INLINE_CODE_0⟧", "⟦INLINE_CODE_1⟧ ⟦INLINE_CODE_0⟧", "⟦INLINE_CODE_0⟧ ⟦INLINE_CODE_1⟧ ⟦INLINE_CODE_2⟧", "⟦INLINE_CODE_00⟧ ⟦INLINE_CODE_1⟧"]) {
    assert.equal(preservesFormatting(markers, translation), false);
    const md = new MarkdownIt();
    extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, translation])));
    const source = "Call `first()` then `second()`.";
    assert.equal(md.render(source, { currentDocument: sourceUri() }), new MarkdownIt().render(source));
  }
});

test("preserves line breaks on both sides of safely escaped inline code", () => {
  const md = new MarkdownIt();
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, "第一行\n⟦INLINE_CODE_0⟧\n最后一行"])));
  const source = "Use `<tag>&value` safely.";
  const html = md.render(source, { currentDocument: sourceUri() });
  assert.equal(html, new MarkdownIt().render(source) + '<p class="translation-review-translation">第一行<br><code>&lt;tag&gt;&amp;value</code><br>最后一行</p>\n');
});

test("does not copy code inside an opaque graphic into translated prose", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  md.render("Read <svg><text>`privateGraphicCode`</text></svg> the guide.", { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => ({ text: paragraph.text, markers: paragraph.markers })), [{ text: "Read the guide.", markers: [] }]);
});

test("leaves a prose paragraph with inline math untouched", () => {
  const md = markdownWithPlugins();
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, "不应显示"]));
  });
  const source = "The formula $x^2 + y^2$ remains readable as one matching paragraph.";
  const native = markdownWithPlugins().render(source);
  assert.equal(md.render(source, { currentDocument: sourceUri() }), native);
  assert.deepEqual(captured, []);
});

test("protects SVG labels across nested tspan HTML tokens while translating surrounding prose", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, "前后正文"]));
  });
  const source = 'Before <svg role="img" data-label="a > b"><text><tspan>First secret <tspan>Nested secret</tspan></tspan><tspan>Second secret</tspan></text></svg> after.';
  const html = md.render(source, { currentDocument: sourceUri() });
  const native = parseFragment(new MarkdownIt({ html: true }).render(source));
  assert.equal(serializeOuter(elements(parseFragment(html), "svg")[0]), serializeOuter(elements(native, "svg")[0]));
  assert.deepEqual(translatedElements(html).map(textContent), ["前后正文"]);
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Before after."]);
});

test("excludes raw graphics and HTML content across blank lines and native paragraph tokens", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  const source = [
    "<svg>", "", "# Secret graphic heading", "", "Secret graphic paragraph.", "", "<text><tspan>Secret label</tspan></text>", "", "</svg>", "",
    '<div class="diagram">', "", "Secret diagram paragraph.", "", "</div>", "",
    "<script>const secretScript = true;</script>", "",
    "After graphics, ordinary prose.", "",
    "![Secret image](picture.svg)", "",
    "`Secret code`", "",
    '<img src="raw.svg" alt="Secret raw alt">',
  ].join("\n");
  assert.equal(md.render(source, { currentDocument: sourceUri() }), new MarkdownIt({ html: true }).render(source));
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["After graphics, ordinary prose."]);
});

test("excludes standalone code, diagrams and plugin math but retains neighboring prose", () => {
  const md = markdownWithPlugins();
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  const source = ["$secretInlineMath$", "", "$$secretBlockMath$$", "", "```mermaid", "graph LR; secretDiagram --> B", "```", "", "```ts", "secretFence()", "```", "", "    secretIndentedCode()", "", "Visible prose after protected blocks."].join("\n");
  assert.equal(md.render(source, { currentDocument: sourceUri() }), markdownWithPlugins().render(source));
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Visible prose after protected blocks."]);
});

test("unknown plugin containers keep their text private while adjacent prose translates", () => {
  const md = new MarkdownIt({ html: true });
  md.inline.ruler.before("text", "sample_graphic", (state, silent) => {
    if (!state.src.startsWith("@graphic@", state.pos)) return false;
    if (!silent) {
      state.push("graphic_open", "svg", 1);
      state.push("text", "", 0).content = "Private plugin label";
      state.push("graphic_close", "svg", -1);
    }
    state.pos += "@graphic@".length;
    return true;
  });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  assert.equal(md.render("@graphic@ Public prose.", { currentDocument: sourceUri() }), "<p><svg>Private plugin label</svg> Public prose.</p>\n");
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Public prose."]);
});

test("places short translations beside headings, tight list items and table labels", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map((paragraph, index) => [paragraph.id, `中文${index}`]));
  });
  const source = "# Heading\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Repeated | Repeated |";
  const html = md.render(source, { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Heading", "First item", "Second item", "Name", "Value", "Repeated", "Repeated"]);
  assert.equal(new Set(captured.map(paragraph => paragraph.id)).size, 7);
  const document = parseFragment(html);
  assert.deepEqual(elements(document, "h1").map(textContent), ["Heading 中文0"]);
  assert.deepEqual(elements(document, "li").map(node => textContent(node).trim()), ["First item 中文1", "Second item 中文2"]);
  assert.deepEqual(elements(document, "th").map(textContent), ["Name 中文3", "Value 中文4"]);
  assert.deepEqual(elements(document, "td").map(textContent), ["Repeated 中文5", "Repeated 中文6"]);
  const translations = translatedElements(html);
  assert.equal(translations.length, 7);
  assert.ok(translations.every(node => node.tagName === "span" && node.attrs.some(attribute => attribute.name === "class" && attribute.value.includes("translation-review-inline"))));
});

test("places Install and Note translations inside their original blocks without changing tokens", () => {
  const md = new MarkdownIt();
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text === "Install" ? "安装" : "笔记"])));
  const tokens = md.parse("# Install\n\nNote", {});
  const before = JSON.stringify(tokens);
  const html = md.renderer.render(tokens, md.options, { currentDocument: sourceUri() });
  const document = parseFragment(html);
  assert.deepEqual(elements(document, "h1").map(textContent), ["Install 安装"]);
  assert.deepEqual(elements(document, "p").map(textContent), ["Note 笔记"]);
  assert.deepEqual(translatedElements(html).map(node => node.parentNode && "tagName" in node.parentNode ? node.parentNode.tagName : undefined), ["h1", "p"]);
  assert.equal(JSON.stringify(tokens), before);
});

test("keeps long source or translation below headings, paragraphs, list items and table labels", () => {
  const longSource = "This original prose is longer than forty characters.";
  const longTranslation = "这是一段需要保留在原文下方的较长译文，不能因为英文标签很短就把整段译文挤在同一行。";
  for (const [source, translation] of [[longSource, "长段正文"], ["Note", longTranslation]]) {
    const md = new MarkdownIt();
    extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, translation])));
    const html = md.render(`# ${source}\n\n${source}\n\n- ${source}\n\n| ${source} |\n| --- |\n| ${source} |`, { currentDocument: sourceUri() });
    const translations = translatedElements(html);
    assert.deepEqual(translations.map(node => node.tagName), ["h1", "p", "div", "span", "span"]);
    assert.ok(translations.every(node => textContent(node) === translation));
    assert.doesNotMatch(html, /translation-review-inline/);
    const document = parseFragment(html);
    assert.deepEqual(elements(document, "h1").map(textContent), [source, translation]);
    assert.deepEqual(elements(document, "p").map(textContent), [source, translation]);
    assert.match(html, /<li>[^<]+<div class="translation-review-translation">/);
  }
});

test("keeps short prose with code, native breaks or translated newlines below the original", () => {
  for (const [source, translation] of [
    ["Use `x`.", "使用 ⟦INLINE_CODE_0⟧。"],
    ["First\nSecond", "第一⟦FORMAT_0⟧第二"],
    ["First  \nSecond", "第一⟦FORMAT_0⟧第二"],
    ["Note", "第一\n第二"],
  ]) {
    const md = new MarkdownIt();
    const native = md.render(source);
    extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, translation])));
    const html = md.render(source, { currentDocument: sourceUri() });
    assert.ok(html.startsWith(native));
    assert.doesNotMatch(html, /translation-review-inline/);
    assert.equal(translatedElements(html).length, 1);
    assert.equal(translatedElements(html)[0].tagName, "p");
    if (source.includes("`")) assert.deepEqual(elements(translatedElements(html)[0], "code").map(textContent), ["x"]);
    else assert.match(serialize(translatedElements(html)[0]), /\n|<br>/);
  }
});

test("keeps long translated headings styled below without duplicating source navigation attributes", () => {
  const md = new MarkdownIt();
  const source = "# This heading contains more than forty characters.";
  const tokens = md.parse(source, {});
  const heading = tokens[0];
  heading.attrSet("id", "original-heading");
  heading.attrSet("data-line", "0");
  heading.attrSet("class", "code-line native-heading");
  heading.attrSet("style", "color: red");
  const before = JSON.stringify(tokens);
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, "较长标题"])));
  const html = md.renderer.render(tokens, md.options, { currentDocument: sourceUri() });
  const headings = elements(parseFragment(html), "h1");
  assert.deepEqual(headings.map(textContent), ["This heading contains more than forty characters.", "较长标题"]);
  assert.deepEqual(headings[1].attrs, [{ name: "class", value: "native-heading translation-review-translation" }, { name: "style", value: "color: red" }]);
  assert.equal(JSON.stringify(tokens), before);
});

test("escapes model HTML and preserves model Markdown as inert text", () => {
  const md = new MarkdownIt({ html: true });
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, '</div><script>alert("x")</script> & **text**\n下一行'])));
  const html = md.render("Safe original.", { currentDocument: sourceUri() });
  assert.equal(html, '<p>Safe original.</p>\n<p class="translation-review-translation">&lt;/div&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; **text**<br>下一行</p>\n');
  assert.doesNotMatch(html, /<script>|<strong>/);
});

test("ignores Chinese paragraphs containing only acronyms but includes genuine English prose", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  md.render("这是已经翻译好的中文段落，使用 API、HTTP 和 SVG。\n\n已经翻译的 iOS 文档。\n\n中文和 English prose mixed together.\n\nAPI", { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["中文和 English prose mixed together.", "API"]);
});

test("reference links retain destinations and titles while autolinks stay local", () => {
  const md = new MarkdownIt({ html: true, linkify: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, "阅读 ⟦FORMAT_0⟧指南⟦FORMAT_1⟧。"]));
  });
  const html = md.render("Read [the guide][guide] and www.private.example at <user@private.example>.\n\n[guide]: https://private.example/path \"Private title\"", { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Read ⟦FORMAT_0⟧the guide⟦FORMAT_1⟧ and at ."]);
  assert.equal(serialize(translatedElements(html)[0]), '阅读 <a href="https://private.example/path" title="Private title">指南</a>。');
  assert.doesNotMatch(captured[0].text, /private|https|www|user@/);
});

test("nested native rendering restores the outer document frame", () => {
  const md = new MarkdownIt({ html: true });
  md.renderer.rules.paragraph_close = (tokens, index, options, env: unknown, self) => {
    const native = self.renderToken(tokens, index, options);
    if (typeof env === "object" && env !== null && "outer" in env) return native + `<aside>${md.render("Nested prose.", { currentDocument: sourceUri("file:///nested.md") })}</aside>`;
    return native;
  };
  extendMarkdownIt(md, (uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, uri.endsWith("nested.md") ? "内部" : "外部"])));
  const html = md.render("Outer prose.", { currentDocument: sourceUri(), outer: true });
  const document = parseFragment(html);
  assert.deepEqual(elements(document, "p").map(textContent), ["Outer prose. 外部", "Nested prose. 内部"]);
  assert.deepEqual(elements(document, "aside").map(textContent), ["Nested prose. 内部\n"]);
  assert.deepEqual(translatedElements(html).map(textContent), ["外部", "内部"]);
});

test("installing the same extension twice never duplicates translated output", () => {
  const md = new MarkdownIt({ html: true });
  const lookup = (_uri: string, paragraphs: readonly Paragraph[]): ReadonlyMap<string, string> => new Map(paragraphs.map(paragraph => [paragraph.id, "一次"]));
  assert.equal(extendMarkdownIt(md, lookup), md);
  assert.equal(extendMarkdownIt(md, lookup), md);
  const env = { currentDocument: sourceUri() };
  const html = md.render("One paragraph.", env);
  assert.deepEqual(translatedElements(html).map(textContent), ["一次"]);
  assert.deepEqual(elements(parseFragment(html), "p").map(textContent), ["One paragraph. 一次"]);
  assert.equal(md.render("One paragraph.", env), html);
});

test("standard-looking prose inside a graphic plugin block is not translated", () => {
  const md = new MarkdownIt({ html: true });
  md.block.ruler.before("paragraph", "sample_graphic_block", (state, startLine, _endLine, silent) => {
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]);
    if (!line.startsWith(":::graphic ")) return false;
    if (silent) return true;
    state.push("graphic_open", "svg", 1).block = true;
    state.push("paragraph_open", "p", 1).block = true;
    const inline = state.push("inline", "", 0);
    inline.content = line.slice(":::graphic ".length);
    inline.children = [];
    state.push("paragraph_close", "p", -1).block = true;
    state.push("graphic_close", "svg", -1).block = true;
    state.line = startLine + 1;
    return true;
  });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, "正文"]));
  });
  const html = md.render(":::graphic Private graphic prose.\n\nPublic prose.", { currentDocument: sourceUri() });
  assert.ok(html.startsWith('<svg>\n<p>Private graphic prose.</p>\n</svg>\n'));
  assert.deepEqual(translatedElements(html).map(textContent), ["正文"]);
  assert.ok(html.includes('Public prose. <span class="translation-review-translation translation-review-inline">正文</span>'));
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Public prose."]);
});

test("empty, foreign and blank results do not change native HTML", () => {
  const md = new MarkdownIt({ html: true });
  const source = "# Original heading\n\nOriginal paragraph.\n\n| Original cell |\n| --- |\n| Original value |";
  const native = md.render(source);
  let mode = 0;
  extendMarkdownIt(md, (_uri, paragraphs) => {
    if (mode === 0) return new Map();
    if (mode === 1) return new Map([["foreign", "不应显示"]]);
    return new Map(paragraphs.map(paragraph => [paragraph.id, " \n "]));
  });
  for (mode = 0; mode < 3; mode++) {
    assert.equal(md.render(source, { currentDocument: sourceUri() }), native);
  }
});

test("omitted autolinks keep surrounding word boundaries", () => {
  const md = new MarkdownIt({ html: true });
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return undefined;
  });
  md.render("Read<https://private.example/path>next.", { currentDocument: sourceUri() });
  assert.deepEqual(captured.map(paragraph => paragraph.text), ["Read next."]);
});

test("renders nested emphasis, strike and link text through native inline rules", () => {
  const md = new MarkdownIt();
  md.renderer.rules.link_open = (tokens, index, _options, _env, _self) => {
    const token = tokens[index];
    const href = token.attrGet("href") ?? "";
    return `<a href="${md.utils.escapeHtml(href)}" data-href="${md.utils.escapeHtml(href)}" title="${md.utils.escapeHtml(token.attrGet("title") ?? "")}" class="native-link">`;
  };
  md.renderer.rules.strong_open = () => '<strong class="native-strong">';
  const source = "Read **very *important* [guide](../guide.md#intro \"Original title\")** and ~~old~~ text.";
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text.replace("Read", "阅读").replace("very", "非常").replace("important", "重要").replace("guide", "指南").replace("and", "以及").replace("old", "旧").replace("text.", "文字。")]));
  });
  const tokens = md.parse(source, {});
  const before = JSON.stringify(tokens);
  const html = md.renderer.render(tokens, md.options, { currentDocument: sourceUri() });
  assert.equal(serialize(translatedElements(html)[0]), '阅读 <strong class="native-strong">非常 <em>重要</em> <a href="../guide.md#intro" data-href="../guide.md#intro" title="Original title" class="native-link">指南</a></strong> 以及 <s>旧</s> 文字。');
  assert.equal(JSON.stringify(tokens), before);
  assert.doesNotMatch(captured[0].text, /guide\.md|intro|Original title|native-link/);
});

test("translated links reuse native destination handling without mutating source tokens", () => {
  const md = new MarkdownIt();
  const destinations = ["https://example.org/path?a=1&b=2", "../guide.md#intro", "#section", "mailto:reader@example.org"];
  const source = destinations.map((href, index) => `[Guide ${index}](${href} "Title ${index}")`).join(" ");
  md.renderer.rules.link_open = (tokens, index, _options, _env, self) => {
    const token = tokens[index];
    const href = token.attrGet("href") ?? "";
    return `<a${self.renderAttrs(token)} data-href="${md.utils.escapeHtml(href)}">`;
  };
  const native = md.render(source);
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text.replaceAll("Guide", "指南")])));
  const tokens = md.parse(source, {});
  const before = JSON.stringify(tokens);
  const html = md.renderer.render(tokens, md.options, { currentDocument: sourceUri() });
  const links = elements(parseFragment(html), "a");
  const translated = translatedElements(html)[0];
  assert.deepEqual(links.slice(0, destinations.length).map(link => serializeOuter(link)), elements(parseFragment(native), "a").map(link => serializeOuter(link)));
  assert.deepEqual(elements(translated, "a").map(textContent), destinations.map((_, index) => `指南 ${index}`));
  for (const [index, href] of destinations.entries()) {
    const link = elements(translated, "a")[index];
    assert.deepEqual(link.attrs, [{ name: "href", value: href }, { name: "title", value: `Title ${index}` }, { name: "data-href", value: href }]);
  }
  assert.equal(JSON.stringify(tokens), before);
});

test("keeps every heading level and styling without copying navigation identities", () => {
  const md = new MarkdownIt();
  const source = Array.from({ length: 6 }, (_, index) => `${"#".repeat(index + 1)} Heading ${index + 1}`).join("\n\n");
  const tokens = md.parse(source, {});
  for (const token of tokens) {
    if (token.type !== "heading_open") continue;
    token.attrSet("id", `native-${token.tag}`);
    token.attrSet("data-line", token.tag.slice(1));
    token.attrSet("class", "code-line native-heading");
    token.attrSet("style", "color: red");
  }
  const before = JSON.stringify(tokens);
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text.replace("Heading", "标题")])));
  const html = md.renderer.render(tokens, md.options, { currentDocument: sourceUri() });
  const document = parseFragment(html);
  assert.equal(translatedElements(html).length, 6);
  for (let level = 1; level <= 6; level++) {
    const headings = elements(document, `h${level}`);
    assert.equal(headings.length, 1);
    assert.equal(textContent(headings[0]), `Heading ${level} 标题 ${level}`);
    assert.equal(headings[0].attrs.find(attribute => attribute.name === "style")?.value, "color: red");
    assert.equal(html.split(`id="native-h${level}"`).length - 1, 1);
    assert.equal(html.split(`data-line="${level}"`).length - 1, 1);
    const translation = elements(headings[0], "span")[0];
    assert.equal(translation.parentNode, headings[0]);
    assert.deepEqual(translation.attrs, [{ name: "class", value: "translation-review-translation translation-review-inline" }]);
  }
  assert.equal(JSON.stringify(tokens), before);
});

test("escapes translated HTML inside preserved link and emphasis boundaries", () => {
  const md = new MarkdownIt({ html: true });
  extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, '⟦FORMAT_0⟧⟦FORMAT_1⟧</a><img src=x onerror=alert(1)> & **text**⟦FORMAT_2⟧⟦FORMAT_3⟧'])));
  const html = md.render("**[Guide](./guide.md)**", { currentDocument: sourceUri() });
  assert.match(html, /<p class="translation-review-translation"><strong><a href="\.\/guide\.md">&lt;\/a&gt;&lt;img src=x onerror=alert\(1\)&gt; &amp; \*\*text\*\*<\/a><\/strong><\/p>/);
  assert.doesNotMatch(html, /<img/);
});

test("rejects missing, reordered, duplicated, malformed and invented formatting markers", () => {
  const source = "**[Guide](./guide.md)**";
  const valid = "⟦FORMAT_0⟧⟦FORMAT_1⟧指南⟦FORMAT_2⟧⟦FORMAT_3⟧";
  for (const translation of [
    "指南",
    valid.replace("⟦FORMAT_1⟧", ""),
    valid.replace("⟦FORMAT_2⟧⟦FORMAT_3⟧", "⟦FORMAT_3⟧⟦FORMAT_2⟧"),
    valid + "⟦FORMAT_0⟧",
    valid.replace("⟦FORMAT_0⟧", "⟦FORMAT_00⟧"),
    valid.replace("⟦FORMAT_0⟧", "⟦FORMAT_0"),
    valid + "⟦FORMAT_99⟧",
    valid + "⟦INLINE_CODE_0⟧",
  ]) {
    const md = new MarkdownIt();
    extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, translation])));
    assert.equal(md.render(source, { currentDocument: sourceUri() }), new MarkdownIt().render(source));
  }
});

test("snapshot identity changes when the same link label gets a different local destination", () => {
  const md = new MarkdownIt();
  const snapshots: (readonly Paragraph[])[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    snapshots.push(paragraphs);
    return undefined;
  });
  const env = { currentDocument: sourceUri() };
  md.render("[Guide](./first.md \"First title\")", env);
  md.render("[Guide](./second.md \"Second title\")", env);
  assert.equal(snapshots[0][0].id, snapshots[1][0].id);
  assert.equal(snapshots[0][0].text, snapshots[1][0].text);
  assert.notEqual(snapshots[0][0].formatting, snapshots[1][0].formatting);
});

test("retains completed translations when native renderers annotate cached tokens", () => {
  const md = new MarkdownIt();
  md.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
    tokens[index].attrSet("id", "heading");
    return self.renderToken(tokens, index, options);
  };
  md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    tokens[index].attrSet("data-href", tokens[index].attrGet("href") ?? "");
    return self.renderToken(tokens, index, options);
  };
  let snapshot: readonly Paragraph[] | undefined;
  const translations = new Map<string, string>();
  extendMarkdownIt(md, (_uri, paragraphs) => {
    if (snapshot && paragraphs.some((paragraph, index) => paragraph.formatting !== snapshot?.[index].formatting)) translations.clear();
    snapshot = paragraphs;
    return translations;
  });
  const tokens = md.parse("# Heading\n\n[Guide](./guide.md)", {});
  const env = { currentDocument: sourceUri() };
  md.renderer.render(tokens, md.options, env);
  assert.ok(snapshot);
  for (const paragraph of snapshot) translations.set(paragraph.id, paragraph.text.replace("Heading", "标题").replace("Guide", "指南"));
  const translated = md.renderer.render(tokens, md.options, env);
  assert.deepEqual(elements(parseFragment(translated), "h1").map(textContent), ["Heading 标题"]);
  assert.match(translated, /<a href="\.\/guide.md" data-href="\.\/guide.md">指南<\/a>/);
  assert.equal(md.renderer.render(tokens, md.options, env), translated);
});

test("captures late native frontmatter rendering together with prose in one snapshot", () => {
  const md = new MarkdownIt();
  const snapshots: (readonly Paragraph[])[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    snapshots.push(paragraphs);
    return new Map(paragraphs.map(paragraph => [paragraph.id, `译文 ${paragraph.text}`]));
  });
  let calls = 0;
  md.renderer.rules.front_matter = () => {
    calls++;
    return '<table class="frontmatter"><tbody><tr><th>name</th><td>English title</td></tr><tr><th>description</th><td>English description</td></tr></tbody></table>\n';
  };
  const frontMatter = new Token("front_matter", "", 0);
  frontMatter.meta = { content: "name: English title\ndescription: English description" };
  const tokens = [frontMatter, ...md.parse("Ordinary prose.", {})];
  const before = JSON.stringify(tokens);
  const env = { currentDocument: sourceUri() };
  const html = md.renderer.render(tokens, md.options, env);
  assert.equal(calls, 1);
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].map(paragraph => paragraph.text), ["name", "English title", "description", "English description", "Ordinary prose."]);
  assert.deepEqual(translatedElements(html).map(textContent), ["译文 name", "译文 English title", "译文 description", "译文 English description", "译文 Ordinary prose."]);
  assert.deepEqual(elements(parseFragment(html), "td").map(textContent), ["English title 译文 English title", "English description 译文 English description"]);
  assert.deepEqual(elements(parseFragment(html), "p").map(textContent), ["Ordinary prose. 译文 Ordinary prose."]);
  assert.equal(JSON.stringify(tokens), before);
  assert.equal(md.renderer.render(tokens, md.options, env), html);
  assert.equal(calls, 2);
  assert.equal(snapshots.length, 2);
  md.renderer.rules.front_matter = () => "";
  const hidden = md.renderer.render(tokens, md.options, env);
  assert.doesNotMatch(hidden, /English title|English description|frontmatter/);
  assert.deepEqual(snapshots[2].map(paragraph => paragraph.text), ["Ordinary prose."]);
});

test("frontmatter code, errors and missing translation results preserve native output", () => {
  for (const frontHtml of [
    '<pre><code class="language-yaml">name: Private code</code></pre>\n',
    '<div class="frontmatter-error">Native error</div>\n',
    '<table class="frontmatter"><tbody><tr><th>name</th><td>English title</td></tr></tbody></table>\n',
  ]) {
    const md = new MarkdownIt();
    let calls = 0;
    extendMarkdownIt(md, () => undefined);
    md.renderer.rules.front_matter = () => {
      calls++;
      return frontHtml;
    };
    assert.equal(md.renderer.render([new Token("front_matter", "", 0)], md.options, { currentDocument: sourceUri() }), frontHtml);
    assert.equal(calls, 1);
  }
});

test("does not publish unmatched markup hidden across an opaque HTML boundary", () => {
  const md = new MarkdownIt({ html: true });
  const source = "Read *visible <span>hidden*</span> prose.";
  const native = md.render(source);
  let captured: readonly Paragraph[] = [];
  extendMarkdownIt(md, (_uri, paragraphs) => {
    captured = paragraphs;
    return new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text]));
  });
  assert.equal(md.render(source, { currentDocument: sourceUri() }), native);
  assert.deepEqual(captured, []);
});

test("preserves native hard and soft line breaks in translated prose", () => {
  for (const breaks of [false, true]) {
    const md = new MarkdownIt({ breaks });
    const source = "First line  \nSecond line\nThird line";
    const native = md.render(source);
    extendMarkdownIt(md, (_uri, paragraphs) => new Map(paragraphs.map(paragraph => [paragraph.id, paragraph.text.replace("First line", "第一行").replace("Second line", "第二行").replace("Third line", "第三行")])));
    const html = md.render(source, { currentDocument: sourceUri() });
    assert.equal(html, native + `<p class="translation-review-translation">第一行<br>\n第二行${breaks ? "<br>\n" : "\n"}第三行</p>\n`);
  }
});
