import { secretField, type ISchemaField } from '../search/schema';

/** Bookkeeping fields: they say nothing about what a record is about. */
const bookkeeping = new Set([
  'autoNumber',
  'createdBy',
  'lastModifiedBy',
  'button',
  'createdTime',
  'lastModifiedTime',
]);
const longTypes = new Set(['longText', 'richText']);
/** A value longer than this, or with a line break, gets a section of its own. */
const shortValue = 120;
export const MASK = '••••••';

export interface IRecordMarkdown {
  title: string;
  markdown: string;
  /** The record's context: the title and every value shown, without the Markdown around them. */
  chars: number;
  /** Fields whose values were masked. */
  masked: string[];
}

/** File cells in the text format carry their links: only the names are shown. */
const withoutLinks = (text: string) => text.replace(/\s*\(https?:\/\/[^)]*\)/g, '');
const cellOf = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const utc = (iso?: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : undefined);

interface IShown {
  name: string;
  value: string;
  long: boolean;
  masked: boolean;
}

/** A field's value as the reader shows it, or undefined when it shows nothing. */
function shownOf(field: ISchemaField, raw: string | undefined): IShown | undefined {
  const text = raw?.trim();
  if (!text || bookkeeping.has(field.type)) return undefined;
  if (secretField.test(field.name))
    return { name: field.name, value: MASK, long: false, masked: true };
  const value = field.type === 'attachment' ? withoutLinks(text) : text;
  const long = longTypes.has(field.type) || value.length > shortValue || value.includes('\n');
  return { name: field.name, value, long, masked: false };
}

/**
 * A record as Markdown for the cockpit's reader (scope design §8.2): the primary field as the
 * heading, short values in a table, long text as sections (knowledge entries are Markdown
 * already), bookkeeping fields left out, file cells by name, secret-looking fields masked. Pure.
 */
export function recordMarkdown(
  table: { name: string; fields: ISchemaField[] },
  cells: Record<string, string>,
  lastModifiedTime?: string
): IRecordMarkdown {
  const primary = table.fields.find((f) => f.isPrimary);
  const title = (primary && cells[primary.id]?.trim()) || '(untitled)';
  const shown = table.fields
    .filter((f) => f !== primary)
    .map((f) => shownOf(f, cells[f.id]))
    .filter((v): v is IShown => Boolean(v));
  const short = shown.filter((v) => !v.long);
  const updated = utc(lastModifiedTime);
  const lines = [
    `# ${cellOf(title)}`,
    '',
    `\`${table.name}\`${updated ? ` · updated ${updated}` : ''}`,
  ];
  if (short.length) {
    lines.push('', '| Field | Value |', '| --- | --- |');
    for (const v of short) lines.push(`| ${cellOf(v.name)} | ${cellOf(v.value)} |`);
  }
  for (const v of shown.filter((x) => x.long)) lines.push('', `## ${cellOf(v.name)}`, '', v.value);
  return {
    title,
    markdown: `${lines.join('\n')}\n`,
    chars: shown.reduce((n, v) => n + (v.masked ? 0 : v.value.length), title.length),
    masked: shown.filter((v) => v.masked).map((v) => v.name),
  };
}
