/** Plain-text helpers for knowledge sources (design §11.3). */

export const looksMarkdown = (text: string) => /^#{1,3}[ \t]|^```/m.test(text);

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Readable text of an HTML page: no scripts or styles, block tags become line breaks. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null;
  const text = html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<\/?(?:p|div|section|article|li|ul|ol|tr|table|br|hr|h[1-6]|pre|blockquote)\b[^>]*>/gi,
      '\n\n'
    )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#(\d+)|([a-z]+));/gi, (m, code: string, name: string) =>
      code ? String.fromCodePoint(Number(code)) : entities[name.toLowerCase()] ?? m
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
  return { title, text };
}

/** A cell value as text: arrays joined, link and user objects by their title or name. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const o = value as { title?: unknown; name?: unknown };
    return String(o.title ?? o.name ?? '');
  }
  return String(value);
}
