export function isUnchangedTranslation(source: string, translation: string): boolean {
  return source.replace(/\s+/g, " ").trim() === translation.replace(/\s+/g, " ").trim();
}

export function shouldInlineTranslation(source: string, translation: string): boolean {
  for (const text of [source, translation]) {
    const prose = text.replace(/⟦(?:FORMAT|INLINE_CODE)_\d+⟧/g, "").trim();
    if (!prose || /[\r\n]/.test(text)) return false;
    let length = 0;
    for (const _character of prose) {
      if (++length > 40) return false;
    }
  }
  return true;
}
