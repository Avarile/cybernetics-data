import type { IAiDataFieldSummary, IAiDataTableProfile } from '../../../ai-data/ai-data.schema';
import type { IRagSourceText } from '../../domain/ports';
import { cellText } from './text-extract';

/** One value is cut here; the whole record keeps the document limit. */
export const MAX_VALUE_CHARS = 20_000;

/** Bookkeeping fields: they say nothing about what a record is about. */
const bookkeeping = new Set([
  'button',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
]);
/** What a knowledge table without a context field is read from (today's behaviour). */
const knowledgeTypes = new Set(['singleLineText', 'longText', 'singleSelect', 'multipleSelect']);

/** A cell as text: text cells arrive as strings (CellFormat.Text); anything else is flattened. */
const valueOf = (value: unknown) => {
  const text = typeof value === 'string' ? value : cellText(value);
  const clean = text.trim();
  return clean.length > MAX_VALUE_CHARS ? `${clean.slice(0, MAX_VALUE_CHARS)}…` : clean;
};

/**
 * A record as search reads it (current-design §4.5), from its text cells. The primary field is the
 * title. A knowledge table gives its context field (or, without one, its text fields by name); any
 * other table gives every field that has a value as `Field name: value`, bookkeeping fields left
 * out. A record whose deleted_at is set is gone (undefined).
 */
export function recordText(
  fields: IAiDataFieldSummary[],
  profile: IAiDataTableProfile,
  cells: Record<string, unknown>,
  mode: 'knowledge' | 'records'
): IRagSourceText | undefined {
  const { titleFieldId, contextFieldId, softDeleteFieldId } = profile;
  if (softDeleteFieldId && valueOf(cells[softDeleteFieldId])) return undefined;
  const title = titleFieldId ? valueOf(cells[titleFieldId]) || null : null;
  if (mode === 'knowledge' && contextFieldId) {
    return { title, text: valueOf(cells[contextFieldId]), format: 'record' };
  }
  const text = fields
    .filter(
      (f) =>
        f.id !== titleFieldId &&
        f.id !== softDeleteFieldId &&
        (mode === 'knowledge' ? knowledgeTypes.has(f.type) : !bookkeeping.has(f.type))
    )
    .map((f) => [f.name, valueOf(cells[f.id])])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n\n');
  return { title, text, format: 'record' };
}
