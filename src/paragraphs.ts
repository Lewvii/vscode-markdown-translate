import type MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import Token from "markdown-it/lib/token.mjs";
import { captureFrontMatter, type FrontMatterCapture } from "./frontmatter";
import { shouldInlineTranslation } from "./translationLayout";

export type Paragraph = { id: string; text: string; markers: readonly string[]; formatting: string };

type Block = { paragraph: Paragraph; open: Token; protectedTokens: readonly Token[]; close: number; inside: boolean };
type RenderFrame = { tokens: readonly Token[]; insertions: ReadonlyMap<number, { html: string; inside: boolean }>; frontMatter: ReadonlyMap<number, string> };

const extended = new WeakSet<MarkdownIt>();
const proseOpen: Record<string, true | undefined> = { paragraph_open: true, heading_open: true, th_open: true, td_open: true };
const containers: Record<string, true | undefined> = { paragraph_open: true, heading_open: true, th_open: true, td_open: true, blockquote_open: true, bullet_list_open: true, ordered_list_open: true, list_item_open: true, table_open: true, thead_open: true, tbody_open: true, tr_open: true };
const inlineMarkup: Record<string, true | undefined> = { em_open: true, em_close: true, strong_open: true, strong_close: true, s_open: true, s_close: true, link_open: true, link_close: true, hardbreak: true, softbreak: true };
const voidTags: Record<string, true | undefined> = { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, link: true, meta: true, param: true, source: true, track: true, wbr: true };

function trackHtml(content: string, tags: string[]): void {
  const markup = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-z][\w:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of content.matchAll(markup)) {
    if (!match[1]) continue;
    const name = match[1].toLowerCase();
    if (match[0].startsWith("</")) {
      const index = tags.lastIndexOf(name);
      if (index !== -1) tags.splice(index);
    } else if (voidTags[name] !== true && !match[0].endsWith("/>")) {
      tags.push(name);
    }
  }
}

function withoutUrls(md: MarkdownIt, text: string): string {
  text = text.replace(/\b(?:https?:\/\/|www\.)[^\s<>]+/gi, " ");
  const links = md.linkify.match(text);
  if (!links) return text;
  let result = "";
  let start = 0;
  for (const link of links) {
    result += text.slice(start, link.index) + " ";
    start = link.lastIndex;
  }
  return result + text.slice(start);
}

function inlineProse(md: MarkdownIt, children: readonly Token[], htmlTags: string[], markers: string[], protectedTokens: Token[]): string {
  let text = "";
  let opaqueDepth = 0;
  let autoLinkDepth = 0;
  let codeIndex = 0;
  let formatIndex = 0;
  for (const token of children) {
    if (token.type === "html_inline") {
      trackHtml(token.content, htmlTags);
      text += " ";
      continue;
    }
    if (token.type === "link_open" && (token.markup === "autolink" || token.markup === "linkify")) {
      autoLinkDepth++;
      text += " ";
      continue;
    }
    if (token.type === "link_close" && autoLinkDepth > 0) {
      autoLinkDepth--;
      text += " ";
      continue;
    }
    if (inlineMarkup[token.type] === true || token.type === "code_inline") {
      if (opaqueDepth === 0 && autoLinkDepth === 0 && htmlTags.length === 0) {
        const marker = token.type === "code_inline" ? `⟦INLINE_CODE_${codeIndex++}⟧` : `⟦FORMAT_${formatIndex++}⟧`;
        markers.push(marker);
        protectedTokens.push(token);
        text += marker;
      }
      continue;
    }
    if (token.nesting === -1) opaqueDepth = Math.max(0, opaqueDepth - 1);
    if (opaqueDepth === 0 && autoLinkDepth === 0 && htmlTags.length === 0 && token.type === "text") {
      text += withoutUrls(md, token.content);
    } else {
      text += " ";
    }
    if (token.nesting === 1) opaqueDepth++;
  }
  const nesting: string[] = [];
  for (const token of protectedTokens) {
    if (token.nesting === 1) nesting.push(token.tag);
    if (token.nesting === -1 && nesting.pop() !== token.tag) return "";
  }
  if (nesting.length) return "";
  return text.replace(/\s+/g, " ").trim();
}

function worthTranslating(text: string): boolean {
  const prose = text.replace(/⟦(?:INLINE_CODE|FORMAT)_\d+⟧/g, "");
  const words = prose.match(/[A-Za-z]+/g);
  if (!words) return false;
  return !/\p{Script=Han}/u.test(prose) || words.some(word => /[a-z]{2}/.test(word));
}

export function preservesFormatting(markers: readonly string[], translation: string): boolean {
  const actual = translation.match(/⟦[^⟦⟧]*⟧|[⟦⟧]/g) ?? [];
  return actual.length === markers.length && actual.every((marker, index) => marker === markers[index]);
}

function cloneToken(token: Token): Token {
  const clone = Object.assign(new Token(token.type, token.tag, token.nesting), token);
  clone.attrs = token.attrs?.map(([name, value]) => [name, value]) ?? null;
  clone.children = token.children?.map(cloneToken) ?? null;
  return clone;
}

function renderTranslation(md: MarkdownIt, translation: string, block: Block, options: MarkdownIt["options"], env: unknown): string | undefined {
  if (!preservesFormatting(block.paragraph.markers, translation)) return undefined;
  const tokens: Token[] = [];
  let start = 0;
  let index = 0;
  for (const match of translation.matchAll(/⟦(?:INLINE_CODE|FORMAT)_\d+⟧/g)) {
    const text = new Token("text", "", 0);
    text.content = translation.slice(start, match.index);
    tokens.push(text, cloneToken(block.protectedTokens[index++]));
    start = match.index + match[0].length;
  }
  const text = new Token("text", "", 0);
  text.content = translation.slice(start);
  tokens.push(text);
  return tokens.map((token, index) => {
    if (token.type === "text") return md.utils.escapeHtml(token.content).replace(/\r\n?|\n/g, "<br>");
    const rule = md.renderer.rules[token.type];
    return rule ? rule.call(md.renderer.rules, tokens, index, options, env, md.renderer) : md.renderer.renderToken(tokens, index, options);
  }).join("");
}

function extractBlocks(md: MarkdownIt, tokens: readonly Token[]): Block[] {
  const blocks: Block[] = [];
  const containersOpaque: boolean[] = [];
  const htmlTags: string[] = [];
  let opaqueDepth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "html_block") trackHtml(token.content, htmlTags);
    if (token.nesting === -1 && containersOpaque.pop()) opaqueDepth--;
    if (token.type === "inline") {
      const markers: string[] = [];
      const protectedTokens: Token[] = [];
      const text = inlineProse(md, token.children ?? [], htmlTags, markers, protectedTokens);
      const open = tokens[index - 1];
      const close = tokens[index + 1];
      if (!token.children?.some(child => child.type === "math_inline") && opaqueDepth === 0 && open && close && proseOpen[open.type] === true && close.nesting === -1 && close.tag === open.tag && worthTranslating(text) && preservesFormatting(markers, text)) {
        const location = open.map?.join(":") ?? "unmapped";
        const formatting = JSON.stringify([
          open.tag,
          open.attrs?.filter(([name]) => name !== "id") ?? [],
          open.hidden,
          protectedTokens.map(token => ({ ...token, attrs: token.attrs?.filter(([name]) => name !== "data-href") ?? [] })),
        ]);
        blocks.push({ paragraph: { id: `${location}:${index}`, text, markers, formatting }, open, protectedTokens, close: index + 1, inside: open.tag === "th" || open.tag === "td" });
      }
    }
    if (token.nesting === 1) {
      const opaque = containers[token.type] !== true;
      containersOpaque.push(opaque);
      if (opaque) opaqueDepth++;
    }
  }
  return blocks;
}

function documentUri(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null || !("currentDocument" in env)) return undefined;
  const document: unknown = env.currentDocument;
  if (typeof document !== "object" || document === null || !("toString" in document) || typeof document.toString !== "function" || document.toString === Object.prototype.toString) return undefined;
  const uri: unknown = document.toString();
  return typeof uri === "string" && uri.length > 0 ? uri : undefined;
}

export function extendMarkdownIt(md: MarkdownIt, lookup: (uri: string, paragraphs: readonly Paragraph[]) => ReadonlyMap<string, string> | undefined): MarkdownIt {
  if (extended.has(md)) return md;
  extended.add(md);
  let frame: RenderFrame | undefined;
  let nativeFrontMatter: RenderRule | undefined;
  const frontMatterRule: RenderRule = function(this: MarkdownIt["renderer"]["rules"], tokens, index, options, env, self) {
    const captured = frame?.tokens === tokens ? frame.frontMatter.get(index) : undefined;
    return captured ?? (nativeFrontMatter ? nativeFrontMatter.call(this, tokens, index, options, env, self) : self.renderToken(tokens, index, options));
  };
  for (const type of ["paragraph_close", "heading_close", "th_close", "td_close"]) {
    const original = md.renderer.rules[type];
    md.renderer.rules[type] = function(this: MarkdownIt["renderer"]["rules"], tokens, index, options, env, self) {
      const native = original ? original.call(this, tokens, index, options, env, self) : self.renderToken(tokens, index, options);
      const insertion = frame?.tokens === tokens ? frame.insertions.get(index) : undefined;
      if (!insertion) return native;
      return insertion.inside ? insertion.html + native : native + insertion.html;
    };
  }
  const originalRender = md.renderer.render;
  md.renderer.render = function(this: MarkdownIt["renderer"], tokens, options, env: unknown) {
    const previous = frame;
    frame = undefined;
    try {
      const uri = documentUri(env);
      if (uri !== undefined) {
        if (md.renderer.rules.front_matter !== frontMatterRule) {
          nativeFrontMatter = md.renderer.rules.front_matter;
          if (nativeFrontMatter) md.renderer.rules.front_matter = frontMatterRule;
        }
        const frontMatter = new Map<number, FrontMatterCapture>();
        const frontMatterParagraphs: Paragraph[] = [];
        if (nativeFrontMatter) {
          for (let index = 0; index < tokens.length; index++) {
            if (tokens[index].type !== "front_matter") continue;
            const html = nativeFrontMatter.call(this.rules, tokens, index, options, env, this);
            const captured = captureFrontMatter(html, `frontmatter:${index}:`);
            frontMatter.set(index, captured);
            frontMatterParagraphs.push(...captured.paragraphs.filter(paragraph => worthTranslating(paragraph.text) && preservesFormatting([], paragraph.text)).map(paragraph => ({ ...paragraph, markers: [], formatting: html })));
          }
        }
        const blocks = extractBlocks(md, tokens);
        const translations = lookup(uri, [...frontMatterParagraphs, ...blocks.map(block => block.paragraph)]);
        const insertions = new Map<number, { html: string; inside: boolean }>();
        for (const block of blocks) {
          const translation = translations?.get(block.paragraph.id);
          if (!translation?.trim()) continue;
          const htmlText = renderTranslation(md, translation, block, options, env);
          if (htmlText === undefined) continue;
          if (shouldInlineTranslation(block.paragraph.text, translation) && !block.protectedTokens.some(token => token.type === "code_inline" || token.type === "hardbreak" || token.type === "softbreak")) {
            insertions.set(block.close, { html: ` <span class="translation-review-translation translation-review-inline">${htmlText}</span>`, inside: true });
            continue;
          }
          const open = cloneToken(block.open);
          open.tag = block.inside ? "span" : block.open.hidden ? "div" : block.open.tag;
          open.hidden = false;
          open.block = false;
          open.attrs = open.attrs?.filter(([name]) => name !== "id" && name !== "data-line") ?? null;
          const classes = open.attrGet("class");
          if (classes) open.attrSet("class", classes.split(/\s+/).filter(name => name !== "code-line").join(" "));
          open.attrJoin("class", "translation-review-translation");
          const html = `${this.renderToken([open], 0, options)}${htmlText}</${open.tag}>${block.inside ? "" : "\n"}`;
          insertions.set(block.close, { html, inside: block.inside });
        }
        const safeTranslations = new Map<string, string>();
        for (const paragraph of frontMatterParagraphs) {
          const translation = translations?.get(paragraph.id);
          if (translation?.trim() && preservesFormatting(paragraph.markers, translation)) safeTranslations.set(paragraph.id, translation);
        }
        frame = { tokens, insertions, frontMatter: new Map(Array.from(frontMatter, ([index, captured]) => [index, captured.render(safeTranslations)])) };
      }
      return originalRender.call(this, tokens, options, env);
    } finally {
      frame = previous;
    }
  };
  return md;
}
