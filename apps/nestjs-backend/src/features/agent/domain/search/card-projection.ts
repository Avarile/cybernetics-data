import { secretField, type IFieldRecord, type ISchemaField, type ITableSchema } from './schema';
import type { ISearchCard, ISearchStep, ISearchTone } from './search.types';
import { sizeOfAmount, sizeOfPriority, toneOf } from './tone';

export const SNIPPET_CHARS = 200;
export const CARD_FIELDS = 4;
const valueChars = 80;

const statusName = /status|progress|state|stage/i;
const priorityName = /priority/i;
const amountName = /amount|value|total|price|balance|budget|cost|score/i;
const dueName = /deadline|due/i;
const dateOrder = [/deadline|due/i, /^date$/i, /finished/i, /started/i, /updated|modified/i];
const hiddenTypes = new Set(['attachment', 'button']);
const selects = new Set(['singleSelect', 'multipleSelect']);
const numbers = new Set(['number', 'currency', 'rating', 'percent']);
const dates = new Set(['date', 'createdTime', 'lastModifiedTime']);
const longTexts = new Set(['longText']);
/** Bookkeeping fields every data table has; not worth a card line. */
const bookkeeping = /^(?:id|created_at|updated_at|deleted_at|is_active|created_by|updated_by)$/i;

/** A link cell's records: `{ id, title }` or a list of them. */
export const linkValues = (value: unknown): { id: string; title: string }[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .filter((v): v is { id: string; title?: unknown } =>
      Boolean(v && typeof v === 'object' && 'id' in v)
    )
    .map((v) => ({ id: String(v.id), title: v.title == null ? '' : String(v.title) }));

/** A cell as one short line of text. */
export function cellText(value: unknown, max = valueChars): string {
  if (value == null || value === '') return '';
  let text: string;
  if (Array.isArray(value))
    text = value
      .map((v) => cellText(v, max))
      .filter(Boolean)
      .join(', ');
  else if (typeof value === 'object') {
    const v = value as { title?: unknown; name?: unknown };
    text = String(v.title ?? v.name ?? '');
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value))
    text = value.slice(0, 10);
  else text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Markdown to plain text for a snippet. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "projects" → "PROJECT", "finance_Transactions" → "TRANSACTION". */
export function shortName(table: string): string {
  const base = table.split('_').pop() || table;
  const upper = base.toUpperCase();
  return upper.length > 3 && upper.endsWith('S') && !upper.endsWith('SS')
    ? upper.slice(0, -1)
    : upper;
}

const visible = (f: ISchemaField) => !secretField.test(f.name) && !hiddenTypes.has(f.type);
const isTrue = (v: unknown) => v === true || v === 'true';

export interface ICardInput {
  record: IFieldRecord;
  table: ITableSchema;
  step: Pick<ISearchStep, 'id'>;
  via?: ISearchCard['via'];
  now?: Date;
}

type IValueOf = (f: ISchemaField | undefined) => unknown;

/** Tone, size, alert and the date a card shows. */
function encode(fields: ISchemaField[], value: IValueOf, archived: boolean, now: Date) {
  const statusField = fields.find((f) => f.type === 'singleSelect' && statusName.test(f.name));
  const state = cellText(value(statusField)) || undefined;
  let tone: ISearchTone = statusField ? toneOf(state) : 'none';
  if (archived) tone = 'faint';

  const priority = fields.find((f) => selects.has(f.type) && priorityName.test(f.name));
  const amount = fields.find((f) => numbers.has(f.type) && amountName.test(f.name));
  let size: number | undefined;
  if (priority) size = sizeOfPriority(value(priority));
  else if (amount) size = sizeOfAmount(value(amount));

  const dateFields = fields.filter((f) => dates.has(f.type) && value(f));
  const dateField = dateOrder.map((re) => dateFields.find((f) => re.test(f.name))).find(Boolean);
  const due = dateFields.find((f) => dueName.test(f.name));
  const dueAt = due ? Date.parse(String(value(due))) : NaN;
  const open = !archived && tone !== 'ink' && tone !== 'faint';
  const alert = open && !Number.isNaN(dueAt) && dueAt < now.getTime();
  return {
    statusField,
    state,
    tone,
    priority,
    amount,
    size,
    due,
    dateField,
    date: dateField ? cellText(value(dateField)).slice(0, 10) : undefined,
    alert,
  };
}

/** Up to four short fields: priority, single links (people, parents), the due date, an amount, then others. */
function cardFields(
  fields: ISchemaField[],
  value: IValueOf,
  skip: (ISchemaField | undefined)[],
  first: (ISchemaField | undefined)[]
) {
  const lines: { name: string; value: string }[] = [];
  const add = (f: ISchemaField | undefined) => {
    if (!f || lines.length >= CARD_FIELDS || lines.some((l) => l.name === f.name)) return;
    const text = cellText(value(f));
    if (text) lines.push({ name: f.name, value: text });
  };
  const singleLink = (f: ISchemaField) =>
    f.link?.relationship === 'manyOne' || f.link?.relationship === 'oneOne';
  const plain = (f: ISchemaField) =>
    !skip.includes(f) &&
    !bookkeeping.test(f.name) &&
    (selects.has(f.type) || numbers.has(f.type) || f.type === 'singleLineText');
  add(first[0]);
  fields.filter(singleLink).forEach(add);
  first.slice(1).forEach(add);
  fields.filter(plain).forEach(add);
  return lines;
}

function snippetOf(fields: ISchemaField[], value: IValueOf) {
  const longText =
    fields.find((f) => f.name === 'context' && longTexts.has(f.type)) ??
    fields.find((f) => longTexts.has(f.type));
  const body = value(longText);
  return typeof body === 'string' && body.trim()
    ? plainText(body).slice(0, SNIPPET_CHARS)
    : undefined;
}

function linksOf(fields: ISchemaField[], value: IValueOf) {
  const links: Record<string, string[]> = {};
  for (const f of fields) {
    const ids = f.link ? linkValues(value(f)).map((v) => v.id) : [];
    if (ids.length) links[f.name] = ids;
  }
  return Object.keys(links).length ? links : undefined;
}

/**
 * A record as a card (cockpit design §6.7), the way the ai-cockpit encodes any table: tone from
 * a status-like select, size from a priority or amount, an alert for a passed deadline, up to four
 * short fields and a snippet. Secret-looking fields and attachments never appear.
 */
export function projectCard({
  record,
  table,
  step,
  via,
  now = new Date(),
}: ICardInput): ISearchCard {
  const fields = table.fields.filter(visible);
  const value: IValueOf = (f) => (f ? record.fields[f.name] : undefined);
  const primary = fields.find((f) => f.isPrimary) ?? fields[0];
  const number = value(table.fields.find((f) => f.type === 'autoNumber'));
  const archived = isArchived(record, table);
  const e = encode(fields, value, archived, now);
  const snippet = snippetOf(fields, value);
  const links = linksOf(fields, value);
  return {
    key: `${step.id}:${record.id}`,
    stepId: step.id,
    recordId: record.id,
    tableId: table.id,
    table: table.name,
    title: cellText(value(primary), 200) || record.id,
    short: `${shortName(table.name)}${number != null && number !== '' ? ` · #${number}` : ''}`,
    tone: e.tone,
    ...(e.state ? { state: e.state } : {}),
    ...(e.size !== undefined ? { size: e.size } : {}),
    ...(e.alert ? { alert: true } : {}),
    ...(archived ? { archived } : {}),
    fields: cardFields(
      fields,
      value,
      [primary, e.statusField],
      [e.priority, e.due ?? e.dateField, e.amount]
    ),
    ...(snippet ? { snippet } : {}),
    ...(e.date ? { date: e.date } : {}),
    ...(via ? { via } : {}),
    ...(links ? { links } : {}),
  };
}

/** Whether a record is archived: is_active off or deleted_at set. */
export function isArchived(record: IFieldRecord, table: ITableSchema): boolean {
  const isActive = table.fields.find((f) => f.name === 'is_active' && f.type === 'checkbox');
  const deletedAt = table.fields.find((f) => f.name === 'deleted_at');
  return (
    (isActive !== undefined && !isTrue(record.fields[isActive.name])) ||
    Boolean(deletedAt && record.fields[deletedAt.name])
  );
}
