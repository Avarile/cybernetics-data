import type { IBaseGraphQueryRo, IBaseGraphTableQuery } from '@teable/openapi';
import type { ISearchSchema } from '../ports';
import { secretField, systemTable, type ISchemaField, type ITableSchema } from '../search/schema';
import { toneOf } from '../search/tone';
import type { IOverviewDataset, IOverviewTable } from './datasets';

/** Records read per table at most (overview design §8.5). */
export const OVERVIEW_TABLE_LIMIT = 1500;
const day = 864e5;
const selects = new Set(['singleSelect', 'multipleSelect']);
const dateTypes = new Set(['date', 'createdTime', 'lastModifiedTime']);
const single = new Set(['manyOne', 'oneOne']);

/** The fields of a table the encoder reads. */
export interface IOverviewFields {
  tone?: ISchemaField;
  /** The single select whose values are the branches (groupSelect). */
  group?: ISchemaField;
  size?: ISchemaField;
  money?: ISchemaField;
  /** In the dataset's order: the first with a value is the record's date. */
  dates: ISchemaField[];
  active?: ISchemaField;
}

export interface IResolvedTable {
  def: IOverviewTable;
  table: ITableSchema;
  fields: IOverviewFields;
}

export interface IResolvedOverview {
  dataset: IOverviewDataset;
  baseId: string;
  tables: IResolvedTable[];
  /** Null when none of the dataset's tables is in the base. */
  query: IBaseGraphQueryRo | null;
  /** Edge field id → its name, for the edge labels. */
  edgeNames: Record<string, string>;
  missing: string[];
}

const named = (fields: ISchemaField[], name?: string) =>
  name ? fields.find((f) => f.name.toLowerCase() === name.toLowerCase()) : undefined;

/** A field whose value may be read: not secret-looking, not a file. */
const readable = (f: ISchemaField | undefined): f is ISchemaField =>
  Boolean(f && !secretField.test(f.name) && f.type !== 'attachment');

const singleLink = (f: ISchemaField | undefined) =>
  f?.link && single.has(f.link.relationship) ? f : undefined;

/** The select values a record is done with: settled (ink) or cancelled (faint). */
const settledChoices = (def: IOverviewTable, tone: ISchemaField) =>
  (tone.choices ?? []).filter((c) =>
    ['ink', 'faint'].includes(def.toneMap?.[c.toLowerCase()] ?? toneOf(c))
  );

function fieldsOf(def: IOverviewTable, table: ITableSchema): IOverviewFields {
  const tone = def.tone && def.tone !== 'fresh' ? named(table.fields, def.tone) : undefined;
  const active = named(table.fields, 'is_active');
  const group = named(table.fields, def.groupSelect);
  return {
    tone: readable(tone) && selects.has(tone.type) ? tone : undefined,
    group: readable(group) && group.type === 'singleSelect' ? group : undefined,
    size: [named(table.fields, def.size)].find(readable),
    money: [named(table.fields, def.money)].find(readable),
    dates: (def.date ?? [])
      .map((n) => named(table.fields, n))
      .filter((f): f is ISchemaField => readable(f) && dateTypes.has(f.type)),
    active: active?.type === 'checkbox' ? active : undefined,
  };
}

/** Archived out, open work only, within the window: the table's filter, or none. */
function filterOf(r: IResolvedTable, now: Date): IBaseGraphTableQuery['filter'] {
  const set: unknown[] = [];
  const deleted = named(r.table.fields, 'deleted_at');
  if (deleted) set.push({ fieldId: deleted.id, operator: 'isEmpty', value: null });
  const settled = r.def.open && r.fields.tone ? settledChoices(r.def, r.fields.tone) : [];
  if (settled.length)
    set.push({ fieldId: r.fields.tone!.id, operator: 'isNoneOf', value: settled });
  const windowField = r.def.windowDays ? r.fields.dates[0] : undefined;
  if (windowField) {
    const since = new Date(now.getTime() - r.def.windowDays! * day).toISOString();
    set.push({
      fieldId: windowField.id,
      operator: 'isOnOrAfter',
      value: { mode: 'exactDate', exactDate: since, timeZone: 'UTC' },
    });
  }
  return set.length
    ? ({ conjunction: 'and', filterSet: set } as IBaseGraphTableQuery['filter'])
    : undefined;
}

function tableQuery(r: IResolvedTable, missing: string[], now: Date): IBaseGraphTableQuery {
  const { def, table, fields } = r;
  const hierarchy = singleLink(named(table.fields, def.hierarchy));
  const group = singleLink(named(table.fields, def.groupBy));
  if (def.hierarchy && hierarchy?.link?.foreignTableId !== table.id)
    missing.push(`${table.name}.${def.hierarchy}`);
  if (def.groupBy && (!group || group.link!.foreignTableId === table.id))
    missing.push(`${table.name}.${def.groupBy}`);
  const values = [
    fields.tone,
    fields.group,
    fields.size,
    fields.money,
    ...fields.dates,
    fields.active,
  ].filter((f): f is ISchemaField => Boolean(f));
  const filter = filterOf(r, now);
  return {
    tableId: table.id,
    limit: OVERVIEW_TABLE_LIMIT,
    ...(hierarchy && hierarchy.link!.foreignTableId === table.id
      ? { hierarchyFieldId: hierarchy.id }
      : {}),
    ...(group && group.link!.foreignTableId !== table.id ? { groupByFieldId: group.id } : {}),
    ...(filter ? { filter } : {}),
    ...(values.length ? { valueFieldIds: [...new Set(values.map((f) => f.id))].slice(0, 8) } : {}),
  };
}

/**
 * The dataset's edges that the base graph can draw: links between its tables that are not the
 * tree itself (a hierarchy or group field, or the other side of one).
 */
function edgesOf(
  dataset: IOverviewDataset,
  tables: IResolvedTable[],
  queries: IBaseGraphTableQuery[]
) {
  const included = new Set(tables.map((t) => t.table.id));
  const fields = tables.flatMap((t) => t.table.fields);
  const tree = queries.flatMap((q) => [q.hierarchyFieldId, q.groupByFieldId]);
  const twins = tree.map((id) => fields.find((f) => f.id === id)?.link?.symmetricFieldId);
  const structural = new Set([...tree, ...twins].filter(Boolean));
  const named = new Set(dataset.edges.map((e) => e.toLowerCase()));
  const drawable = (f: ISchemaField) =>
    named.has(f.name.toLowerCase()) &&
    Boolean(f.link && included.has(f.link.foreignTableId)) &&
    !structural.has(f.id);
  return Object.fromEntries(fields.filter(drawable).map((f) => [f.id, f.name]));
}

/**
 * A dataset against the live schema (overview design §8.4): the base-graph query with ids only,
 * what each table's records are read for, and what the base lacks. Pure.
 */
export function resolveOverview(
  dataset: IOverviewDataset,
  schema: ISearchSchema,
  now = new Date()
): IResolvedOverview {
  const missing: string[] = [];
  const tables: IResolvedTable[] = [];
  for (const def of dataset.tables) {
    const table = schema.tables.find(
      (t) =>
        t.name.toLowerCase() === def.name.toLowerCase() &&
        !schema.excluded.has(t.id) &&
        !systemTable.test(t.name)
    );
    if (!table) missing.push(def.name);
    else tables.push({ def, table, fields: fieldsOf(def, table) });
  }
  const queries = tables.map((r) => tableQuery(r, missing, now));
  const edgeNames = edgesOf(dataset, tables, queries);
  return {
    dataset,
    baseId: schema.baseId,
    tables,
    query: queries.length
      ? {
          tables: queries,
          linkFieldIds: Object.keys(edgeNames).sort(),
          showTableHubs: false,
          showBaseHub: false,
        }
      : null,
    edgeNames,
    missing,
  };
}
