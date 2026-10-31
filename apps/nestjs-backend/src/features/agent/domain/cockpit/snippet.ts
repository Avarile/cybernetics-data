import { secretField, type ISchemaField } from '../search/schema';

/** Characters a snippet shows, and how many of them come before the match. */
const width = 120;
const before = 40;
const skipped = new Set(['attachment', 'button', 'autoNumber', 'createdBy', 'lastModifiedBy']);

export interface ISnippet {
  field: string;
  text: string;
  /** [start, end) of the match in `text`. */
  match: [number, number];
}

/**
 * Where a search result matched (scope design §10.4): the first field after the title, in field
 * order, whose text holds the query, cut to 120 characters around it. Secret-looking fields are
 * never shown; null when only the title matched. Pure.
 */
export function snippetOf(
  fields: ISchemaField[],
  cells: Record<string, string>,
  q: string
): ISnippet | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  for (const field of fields) {
    if (field.isPrimary || skipped.has(field.type) || secretField.test(field.name)) continue;
    const text = (cells[field.id] ?? '').replace(/\s+/g, ' ').trim();
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, Math.min(at - before, text.length - width));
    const end = Math.min(text.length, start + width);
    const head = start > 0 ? '…' : '';
    const tail = end < text.length ? '…' : '';
    const from = head.length + at - start;
    return {
      field: field.name,
      text: `${head}${text.slice(start, end)}${tail}`,
      match: [from, Math.min(from + needle.length, head.length + end - start)],
    };
  }
  return null;
}
