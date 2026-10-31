import type { IOverviewLegendEntry, IOverviewPresentation } from '@teable/openapi';
import type { ISearchSchema } from '../ports';
import { secretField, systemTable, type ISchemaField, type ITableSchema } from '../search/schema';
import type { IOverviewDataset, IOverviewTable } from './datasets';
import { FRESH_LEGEND, FRESH_TONES, WORK_LEGEND, WORK_TONES } from './presentation';

/** Edge tables drawn around a table at most. */
const maxActors = 2;
const single = new Set(['manyOne', 'oneOne']);
const many = new Set(['manyMany', 'oneMany']);
const statusName = /status|state|stage|progress/i;
const groupName = /status|state|stage|progress|type|category|kind|priority/i;
const sizeName = /priority|importance|urgency/i;
const moneyName = /amount|price|total|value|cost|balance/i;
const updatedNames = ['updated_at', 'last_modified', 'modified_at'];

const up = (name: string) => name.toUpperCase();
/** "tasks" → "TASK": a record's key on the chart. */
const singular = (name: string) =>
  up(name.length > 3 && /[^s]s$/i.test(name) ? name.slice(0, -1) : name);
const usable = (f: ISchemaField) => !secretField.test(f.name);

interface IShape {
  hierarchy?: ISchemaField;
  group?: { field: ISchemaField; table: ITableSchema };
  groupSelect?: ISchemaField;
  tone?: ISchemaField;
  size?: ISchemaField;
  money?: ISchemaField;
  dates: string[];
  actors: { field: ISchemaField; table: ITableSchema }[];
}

/** What the schema offers to draw a table by (scope design §9.2). */
function shapeOf(table: ITableSchema, schema: ISearchSchema): IShape {
  const tables = new Map(
    schema.tables.filter((t) => !systemTable.test(t.name)).map((t) => [t.id, t])
  );
  const fields = table.fields.filter(usable);
  const links = fields.filter((f) => f.link && tables.has(f.link.foreignTableId));
  const selfLink = links.find(
    (f) => f.link!.foreignTableId === table.id && single.has(f.link!.relationship)
  );
  const groupLink = links.find(
    (f) => f.link!.foreignTableId !== table.id && single.has(f.link!.relationship)
  );
  const selects = fields.filter((f) => f.type === 'singleSelect');
  const tone = selects.find((f) => statusName.test(f.name));
  const byType = (type: string) => fields.filter((f) => f.type === type).map((f) => f.name);
  return {
    hierarchy: selfLink,
    group: groupLink && { field: groupLink, table: tables.get(groupLink.link!.foreignTableId)! },
    groupSelect: groupLink ? undefined : selects.find((f) => groupName.test(f.name)) ?? selects[0],
    tone,
    size: fields.find(
      (f) => sizeName.test(f.name) && (f.type === 'singleSelect' || f.type === 'number')
    ),
    money: fields.find(
      (f) => moneyName.test(f.name) && (f.type === 'currency' || f.type === 'number')
    ),
    dates: [...byType('lastModifiedTime'), ...updatedNames, ...byType('createdTime'), 'created_at'],
    actors: links
      .filter(
        (f) =>
          many.has(f.link!.relationship) &&
          f.link!.foreignTableId !== table.id &&
          f.link!.foreignTableId !== groupLink?.link?.foreignTableId
      )
      .filter(
        (f, i, all) => all.findIndex((g) => g.link!.foreignTableId === f.link!.foreignTableId) === i
      )
      .slice(0, maxActors)
      .map((f) => ({ field: f, table: tables.get(f.link!.foreignTableId)! })),
  };
}

function legendOf(shape: IShape, branchTitle: string): IOverviewLegendEntry[] {
  const tones = shape.tone
    ? WORK_LEGEND.map(
        ([tone, label]) => [tone, label.replace(' · LATE', '')] as IOverviewLegendEntry
      )
    : FRESH_LEGEND;
  const grouped = shape.group || shape.groupSelect;
  return [
    ...tones,
    ...(grouped ? [['none', branchTitle, 'ring'] as IOverviewLegendEntry] : []),
    ...(shape.actors.length
      ? [
          [
            'target',
            shape.actors.map((a) => up(a.table.name)).join(' · '),
            'diamond',
          ] as IOverviewLegendEntry,
        ]
      : []),
  ];
}

/**
 * A preset for any table (scope design §9.2), from its schema: the table's records on the rim,
 * under the record of its first single link (or the value of a status-like select), toned by a
 * status-like select or by how recently they changed, with up to two linked tables around it.
 * Pure: the same schema always gives the same preset.
 */
/** The table's own entry: its records on the rim, grouped, toned, sized and dated. */
function itemOf(table: ITableSchema, shape: IShape): IOverviewTable {
  return {
    name: table.name,
    role: 'item',
    ...(shape.hierarchy ? { hierarchy: shape.hierarchy.name } : {}),
    ...(shape.group ? { groupBy: shape.group.field.name } : {}),
    ...(shape.groupSelect ? { groupSelect: shape.groupSelect.name } : {}),
    tone: shape.tone?.name ?? 'fresh',
    ...(shape.size ? { size: shape.size.name } : {}),
    ...(shape.money ? { money: shape.money.name } : {}),
    date: shape.dates,
    orphan: up(table.name),
    short: singular(table.name),
  };
}

/** The table its records hang from, drawn as a tree when it links to itself. */
function branchOf(group: ITableSchema): IOverviewTable {
  const self = group.fields.find(
    (f) => f.link?.foreignTableId === group.id && single.has(f.link.relationship)
  );
  return {
    name: group.name,
    role: 'branch',
    ...(self ? { hierarchy: self.name } : {}),
    orphan: null,
    short: singular(group.name),
  };
}

const actorOf = (a: IShape['actors'][number]): IOverviewTable => ({
  name: a.table.name,
  role: 'actor',
  prune: true,
  orphan: up(a.table.name),
  short: singular(a.table.name),
});

/** What the branches are: the group table, the select, or none (the table itself). */
const branchName = (shape: IShape) => shape.group?.table.name ?? shape.groupSelect?.name;

/**
 * A preset for any table (scope design §9.2), from its schema: the table's records on the rim,
 * under the record of its first single link (or the value of a status-like select), toned by a
 * status-like select or by how recently they changed, with up to two linked tables around it.
 * Pure: the same schema always gives the same preset.
 */
export function autoPreset(
  table: ITableSchema,
  schema: ISearchSchema
): { dataset: IOverviewDataset; presentation: IOverviewPresentation } {
  const shape = shapeOf(table, schema);
  const name = up(table.name);
  const branches = branchName(shape);
  const branchTitle = branches ? up(branches) : name;
  const actorNames = shape.actors.map((a) => up(a.table.name));
  const edges = shape.actors.map((a) => a.field.name);
  let right: IOverviewPresentation['right'];
  if (shape.money) right = 'sum';
  else if (shape.tone) right = 'pct';
  return {
    dataset: {
      id: 'table',
      title: name,
      path: [
        branches ? `${up(branches)} → ${name}` : name,
        ...(actorNames.length ? [`EDGES = ${actorNames.join(', ')}`] : []),
      ].join(' · '),
      tables: [
        ...(shape.group ? [branchOf(shape.group.table)] : []),
        itemOf(table, shape),
        ...shape.actors.map(actorOf),
      ],
      edges,
    },
    presentation: {
      branchTitle,
      unit: 'RECORDS',
      ...(right ? { right } : {}),
      toneNames: shape.tone ? WORK_TONES : FRESH_TONES,
      legend: legendOf(shape, branchTitle),
    },
  };
}
