import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { isUnchangedTranslation, shouldInlineTranslation } from "./translationLayout";

export type FrontMatterParagraph = { id: string; text: string };
export type FrontMatterCapture = { paragraphs: readonly FrontMatterParagraph[]; render(translations: ReadonlyMap<string, string>): string };

type Element = DefaultTreeAdapterTypes.Element;
type CapturedParagraph = { paragraph: FrontMatterParagraph; sourceText: string; offset: number };

function elementChildren(parent: DefaultTreeAdapterTypes.ParentNode): Element[] | undefined {
  const elements: Element[] = [];
  for (const child of parent.childNodes) {
    if ("tagName" in child) elements.push(child);
    else if (!("value" in child) || child.value.trim()) return undefined;
  }
  return elements;
}

function isClosed(element: Element): boolean {
  return !!element.sourceCodeLocation?.startTag && !!element.sourceCodeLocation.endTag;
}

function isHidden(element: Element): boolean {
  return element.attrs.some(attribute => attribute.name === "hidden" || (attribute.name === "aria-hidden" && attribute.value === "true"));
}

function collectValue(element: Element, prefix: string, paragraphs: CapturedParagraph[]): boolean {
  const location = element.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) return false;
  if (isHidden(element)) return true;

  let text = "";
  for (const child of element.childNodes) {
    if (!("value" in child)) {
      const children = elementChildren(element);
      const list = children?.[0];
      if (children?.length !== 1 || list?.tagName !== "ul") return true;
      if (!isClosed(list)) return false;
      if (isHidden(list)) return true;
      const items = elementChildren(list);
      if (!items) return false;
      for (const item of items) {
        if (item.tagName !== "li" || !collectValue(item, prefix, paragraphs)) return false;
      }
      return true;
    }
    text += child.value;
  }

  const sourceText = text;
  text = text.trim();
  if (/\p{L}/u.test(text)) {
    paragraphs.push({ paragraph: { id: `${prefix}:${location.startOffset}`, text }, sourceText, offset: location.endTag.startOffset });
  }
  return true;
}

function captureTable(table: Element, prefix: string): CapturedParagraph[] {
  if (!isClosed(table) || isHidden(table)) return [];
  const bodies = elementChildren(table);
  const body = bodies?.[0];
  if (bodies?.length !== 1 || !body || body.tagName !== "tbody" || !isClosed(body) || isHidden(body)) return [];
  const rows = elementChildren(body);
  if (!rows) return [];
  const paragraphs: CapturedParagraph[] = [];
  for (const row of rows) {
    if (row.tagName !== "tr" || !isClosed(row)) return [];
    if (isHidden(row)) continue;
    const cells = elementChildren(row);
    const key = cells?.[0];
    const value = cells?.[1];
    if (cells?.length !== 2 || !key || !value || key.tagName !== "th" || value.tagName !== "td") return [];
    if (!collectValue(key, prefix, paragraphs) || !collectValue(value, prefix, paragraphs)) return [];
  }
  return paragraphs;
}

export function captureFrontMatter(html: string, prefix: string): FrontMatterCapture {
  let malformed = false;
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true, onParseError: () => { malformed = true; } });
  const roots = elementChildren(fragment);
  const table = roots?.[0];
  const nativeTable = !malformed && roots?.length === 1 && table?.tagName === "table" && table.attrs.some(attribute => attribute.name === "class" && attribute.value.split(/\s+/).includes("frontmatter"));
  const captured = nativeTable && table ? captureTable(table, prefix) : [];

  return {
    paragraphs: captured.map(item => item.paragraph),
    render(translations) {
      if (!translations.size || !captured.length) return html;
      let result = "";
      let cursor = 0;
      for (const item of captured) {
        const translation = translations.get(item.paragraph.id);
        if (!translation?.trim() || isUnchangedTranslation(item.paragraph.text, translation)) continue;
        const escaped = translation.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?|\n/g, "<br>");
        const translated = shouldInlineTranslation(item.sourceText, translation)
          ? ` <span class="translation-review-translation translation-review-inline">${escaped}</span>`
          : `<div class="translation-review-translation">${escaped}</div>`;
        result += html.slice(cursor, item.offset) + translated;
        cursor = item.offset;
      }
      return cursor ? result + html.slice(cursor) : html;
    },
  };
}
