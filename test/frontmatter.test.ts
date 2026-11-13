import assert from "node:assert/strict";
import test from "node:test";
import { captureFrontMatter } from "../src/frontmatter";

function table(rows: string): string {
  return `<table class="frontmatter" title="Frontmatter" data-vscode-context='{&quot;webviewSection&quot;:&quot;frontMatter&quot;}'><tbody>${rows}</tbody></table>\n`;
}

test("places short native keys and plain values beside their translations", () => {
  const html = table("<tr><th>title</th><td>Translation guide</td></tr><tr><th>description</th><td>Review English documents.</td></tr><tr><th>name</th><td>Documentation reviewer</td></tr>");
  const captured = captureFrontMatter(html, "frontmatter:0");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["title", "Translation guide", "description", "Review English documents.", "name", "Documentation reviewer"]);
  const translations = new Map(captured.paragraphs.map((paragraph, index) => [paragraph.id, ["标题", "翻译指南", "描述", "审阅英文文档。", "名称", "文档审阅员"][index]]));
  assert.equal(captured.render(translations), table('<tr><th>title <span class="translation-review-translation translation-review-inline">标题</span></th><td>Translation guide <span class="translation-review-translation translation-review-inline">翻译指南</span></td></tr><tr><th>description <span class="translation-review-translation translation-review-inline">描述</span></th><td>Review English documents. <span class="translation-review-translation translation-review-inline">审阅英文文档。</span></td></tr><tr><th>name <span class="translation-review-translation translation-review-inline">名称</span></th><td>Documentation reviewer <span class="translation-review-translation translation-review-inline">文档审阅员</span></td></tr>'));
});

test("decodes entities without treating escaped plain values as HTML", () => {
  const html = table("<tr><th>R&amp;D</th><td>A &lt;guide&gt; &quot;quoted&quot; &#39;value&#39; &#x1f600;</td></tr>");
  const captured = captureFrontMatter(html, "entities");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["R&D", "A <guide> \"quoted\" 'value' 😀"]);
  assert.equal(captured.render(new Map()), html);
  const value = captured.paragraphs.find(paragraph => paragraph.text.startsWith("A "));
  assert.ok(value);
  assert.equal(captured.render(new Map([[value.id, "指南"]])), html.replace("</td>", ' <span class="translation-review-translation translation-review-inline">指南</span></td>'));
});

test("translates nested list leaves inside their own li and skips object YAML", () => {
  const html = table("<tr><th>topics</th><td><ul><li>First topic</li><li><ul><li>Nested topic</li><li><code>name: Private object</code></li><li><ul><li>Deep topic</li></ul></li></ul></li><li>42</li><li>中文</li><li></li></ul></td></tr>");
  const captured = captureFrontMatter(html, "lists");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["topics", "First topic", "Nested topic", "Deep topic", "中文"]);
  const translations = new Map(captured.paragraphs.filter(paragraph => paragraph.text !== "topics").map(paragraph => [paragraph.id, `译文 ${paragraph.text}`]));
  const expected = html
    .replace("First topic</li>", 'First topic <span class="translation-review-translation translation-review-inline">译文 First topic</span></li>')
    .replace("Nested topic</li>", 'Nested topic <span class="translation-review-translation translation-review-inline">译文 Nested topic</span></li>')
    .replace("Deep topic</li>", 'Deep topic <span class="translation-review-translation translation-review-inline">译文 Deep topic</span></li>')
    .replace("中文</li>", '中文 <span class="translation-review-translation translation-review-inline">译文 中文</span></li>');
  assert.equal(captured.render(translations), expected);
});

test("preserves native bytes, attributes, and CSS when results are absent or unrelated", () => {
  const html = "<TABLE class='frontmatter other' style='border: 1px solid red' title='Native title'>\n<TBODY><TR><TH data-key='name'>name</TH><TD style='font-weight:bold'>Native &amp; original</TD></TR></TBODY></TABLE>\n";
  const captured = captureFrontMatter(html, "bytes");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["name", "Native & original"]);
  assert.equal(captured.render(new Map()), html);
  assert.equal(captured.render(new Map([["unknown", "未知"]])), html);
  assert.equal(captured.render(new Map(captured.paragraphs.map(paragraph => [paragraph.id, " \n "]))), html);
  const value = captured.paragraphs.find(paragraph => paragraph.text === "Native & original");
  assert.ok(value);
  assert.equal(captured.render(new Map([[value.id, "原文"]])), html.replace("</TD>", ' <span class="translation-review-translation translation-review-inline">原文</span></TD>'));
});

test("keeps only native frontmatter HTML for echoed keys, values and nested list leaves", () => {
  const html = table("<tr><th>标题</th><td> HTTP \t API 配置 </td></tr><tr><th>主题</th><td><ul><li>配置参数</li><li><ul><li>R&amp;D 指南</li></ul></li></ul></td></tr>");
  const captured = captureFrontMatter(html, "echoes");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["标题", "HTTP \t API 配置", "主题", "配置参数", "R&D 指南"]);
  for (const whitespace of [false, true]) {
    const completed = new Map(captured.paragraphs.map(paragraph => [
      paragraph.id,
      whitespace ? ` \n${paragraph.text.replace(/\s+/g, " ")}\r\n ` : paragraph.text,
    ]));
    const before = [...completed];
    assert.equal(captured.render(completed), html);
    assert.equal(captured.render(completed), html);
    assert.deepEqual([...completed], before);
    const title = captured.paragraphs.find(paragraph => paragraph.text === "标题");
    assert.ok(title);
    completed.set(title.id, "Title");
    assert.equal(captured.render(completed), html.replace("标题</th>", '标题 <span class="translation-review-translation translation-review-inline">Title</span></th>'));
  }
});

test("renders frontmatter changes in case and punctuation rather than treating them as echoes", () => {
  const html = table("<tr><th>API</th><td>配置。</td></tr>");
  const captured = captureFrontMatter(html, "changed");
  const translations = new Map(captured.paragraphs.map(paragraph => [paragraph.id, paragraph.text === "API" ? "api" : "配置！"]));
  assert.equal(captured.render(translations), table('<tr><th>API <span class="translation-review-translation translation-review-inline">api</span></th><td>配置。 <span class="translation-review-translation translation-review-inline">配置！</span></td></tr>'));
});

test("does not mutate captured originals or accumulate translations between renders", () => {
  const html = table("<tr><th>name</th><td>Original name</td></tr>");
  const captured = captureFrontMatter(html, "stable");
  const before = structuredClone(captured.paragraphs);
  const translations = new Map(captured.paragraphs.map(paragraph => [paragraph.id, "译文"]));
  const first = captured.render(translations);
  assert.notEqual(first, html);
  assert.equal(captured.render(translations), first);
  assert.equal(captured.render(new Map()), html);
  assert.deepEqual(captured.paragraphs, before);
  assert.deepEqual(captureFrontMatter(html, "stable").paragraphs, before);
});

test("escapes hostile translated HTML and preserves translated line breaks", () => {
  const html = table("<tr><th></th><td>Plain title</td></tr>");
  const captured = captureFrontMatter(html, "escape");
  const paragraph = captured.paragraphs[0];
  assert.ok(paragraph);
  const translation = '<img src=x onerror="alert(1)"> & </td><script>bad()</script>\n\'quoted\'';
  assert.equal(captured.render(new Map([[paragraph.id, translation]])), html.replace("</td>", '<div class="translation-review-translation">&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;/td&gt;&lt;script&gt;bad()&lt;/script&gt;<br>&#39;quoted&#39;</div></td>'));
});

test("escapes short translated HTML in the inline span", () => {
  const html = table("<tr><th></th><td>Plain title</td></tr>");
  const captured = captureFrontMatter(html, "inline-escape");
  const paragraph = captured.paragraphs[0];
  assert.ok(paragraph);
  assert.equal(
    captured.render(new Map([[paragraph.id, '<img src=x> & "标题" \'名\'']])),
    html.replace("</td>", ' <span class="translation-review-translation translation-review-inline">&lt;img src=x&gt; &amp; &quot;标题&quot; &#39;名&#39;</span></td>'),
  );
});

test("keeps long and multiline source values below the original", () => {
  for (const source of [
    "This description is too long to place its translation beside it.",
    "First line\nSecond line",
    "\nTitle",
    "Title\n",
    "First line\r\nSecond line",
  ]) {
    const html = table(`<tr><th></th><td>${source}</td></tr>`);
    const captured = captureFrontMatter(html, "block-source");
    const paragraph = captured.paragraphs[0];
    assert.ok(paragraph);
    assert.equal(
      captured.render(new Map([[paragraph.id, "译文"]])),
      html.replace("</td>", '<div class="translation-review-translation">译文</div></td>'),
    );
  }
});

test("keeps long translations below short keys, values, and list items", () => {
  const html = table("<tr><th>title</th><td>Guide</td></tr><tr><th></th><td><ul><li>Note</li></ul></td></tr>");
  const captured = captureFrontMatter(html, "long-translation");
  const translation = "译".repeat(41);
  const translations = new Map(captured.paragraphs.map(paragraph => [paragraph.id, translation]));
  assert.equal(captured.render(translations), table(`<tr><th>title<div class="translation-review-translation">${translation}</div></th><td>Guide<div class="translation-review-translation">${translation}</div></td></tr><tr><th></th><td><ul><li>Note<div class="translation-review-translation">${translation}</div></li></ul></td></tr>`));
});

test("keeps short multiline translations below the original", () => {
  for (const [translation, escaped] of [
    ["第一行\n第二行", "第一行<br>第二行"],
    ["第一行\r\n第二行", "第一行<br>第二行"],
    ["\n标题", "<br>标题"],
    ["标题\n", "标题<br>"],
  ]) {
    const html = table("<tr><th></th><td>Title</td></tr>");
    const captured = captureFrontMatter(html, "multiline-translation");
    const paragraph = captured.paragraphs[0];
    assert.ok(paragraph);
    assert.equal(
      captured.render(new Map([[paragraph.id, translation]])),
      html.replace("</td>", `<div class="translation-review-translation">${escaped}</div></td>`),
    );
  }
});

test("assigns distinct stable prefixed IDs to repeated keys and list values", () => {
  const html = table("<tr><th>same</th><td><ul><li>same</li><li>same</li></ul></td></tr><tr><th>same</th><td>same</td></tr>");
  const captured = captureFrontMatter(html, "document:frontmatter:2");
  assert.equal(captured.paragraphs.length, 5);
  assert.equal(new Set(captured.paragraphs.map(paragraph => paragraph.id)).size, 5);
  assert.ok(captured.paragraphs.every(paragraph => paragraph.id.startsWith("document:frontmatter:2:")));
  const translations = new Map(captured.paragraphs.map((paragraph, index) => [paragraph.id, `译文${index}`]));
  assert.equal(captured.render(translations), table('<tr><th>same <span class="translation-review-translation translation-review-inline">译文0</span></th><td><ul><li>same <span class="translation-review-translation translation-review-inline">译文1</span></li><li>same <span class="translation-review-translation translation-review-inline">译文2</span></li></ul></td></tr><tr><th>same <span class="translation-review-translation translation-review-inline">译文3</span></th><td>same <span class="translation-review-translation translation-review-inline">译文4</span></td></tr>'));
  assert.deepEqual(captureFrontMatter(html, "document:frontmatter:2").paragraphs, captured.paragraphs);
  assert.ok(captureFrontMatter(html, "other").paragraphs.every(paragraph => !translations.has(paragraph.id)));
});

test("leaves hide, codeBlock, error, non-native HTML, and empty table output untouched", () => {
  for (const html of [
    "",
    "\n",
    '<pre class="frontmatter hljs" title="Frontmatter"><code class="language-yaml">title: Original title</code></pre>\n',
    '<div class="frontmatter-error" role="alert"><strong>Failed to parse frontmatter</strong><pre>Invalid YAML</pre></div>\n',
    '<table><tbody><tr><th>title</th><td>Ordinary HTML table</td></tr></tbody></table>',
    '<div><table class="frontmatter"><tbody><tr><th>title</th><td>Nested raw HTML</td></tr></tbody></table></div>',
    table(""),
    table("<tr><th></th><td></td></tr><tr><th>123</th><td>12345</td></tr>"),
  ]) {
    const captured = captureFrontMatter(html, "unchanged");
    assert.deepEqual(captured.paragraphs, []);
    assert.equal(captured.render(new Map([["unchanged", "不得插入"]])), html);
  }
});

test("leaves malformed native HTML unchanged instead of patching parser repairs", () => {
  for (const html of [
    '<table class="frontmatter"><tbody><tr><th>name</th><td>Unclosed value',
    table("<tr><th>name<td>Implicitly closed key</td></tr>"),
    table("<tr><th>name</th><td><ul><li>Implicitly closed item</ul></td></tr>"),
    '<table class="frontmatter" class="other"><tbody><tr><th>name</th><td>Duplicate attribute</td></tr></tbody></table>',
    '<table class="frontmatter">Fostered text<tbody><tr><th>name</th><td>Moved text</td></tr></tbody></table>',
  ]) {
    const captured = captureFrontMatter(html, "malformed");
    assert.deepEqual(captured.paragraphs, []);
    assert.equal(captured.render(new Map([["malformed:0", "不可插入"]])), html);
  }
});

test("skips code, graphics, interactive markup, and links without flattening their text", () => {
  for (const value of [
    "<code>name: Nested object</code>",
    "<pre>Original code</pre>",
    '<svg><text>Original graphic</text></svg>',
    '<img src="picture.svg" alt="Original picture">',
    '<a href="guide.md" title="Original target">Original link</a>',
    'Read <a href="guide.md">Original link</a> first',
    '<button>Original action</button>',
    '<span>Unknown plugin content</span>',
    '<input value="Original input">',
  ]) {
    const html = table(`<tr><th>name</th><td>${value}</td></tr>`);
    const captured = captureFrontMatter(html, "skip");
    assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["name"]);
    const key = captured.paragraphs[0];
    assert.ok(key);
    assert.equal(captured.render(new Map([[key.id, "名称"]])), html.replace("</th>", ' <span class="translation-review-translation translation-review-inline">名称</span></th>'));
  }
});

test("does not translate explicitly hidden native content", () => {
  const html = '<table class="frontmatter" hidden><tbody><tr><th>name</th><td>Hidden name</td></tr></tbody></table>';
  const hidden = captureFrontMatter(html, "hidden");
  assert.deepEqual(hidden.paragraphs, []);
  assert.equal(hidden.render(new Map()), html);
  const row = table('<tr aria-hidden="true"><th>name</th><td>Hidden value</td></tr><tr><th>title</th><td hidden>Hidden title</td></tr>');
  const captured = captureFrontMatter(row, "hidden-row");
  assert.deepEqual(captured.paragraphs.map(paragraph => paragraph.text), ["title"]);
});
