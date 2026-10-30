import type {
  IAgentOverviewVo,
  IBaseGraphLink,
  IBaseGraphNode,
  IBaseGraphStats,
  IOverviewLink,
  IOverviewNode,
} from '@teable/openapi';
import { cellText } from '../search/card-projection';
import type { ISearchTone } from '../search/search.types';
import { sizeOfAmount, sizeOfPriority, toneOf } from '../search/tone';
import type { IResolvedOverview, IResolvedTable } from './resolve';

const day = 864e5;
const labelChars = 120;
const settled = (tone: ISearchTone) => tone === 'ink' || tone === 'faint';
const hubOf = (tableId: string) => `hub:${tableId}`;
const isBucket = (id?: string | null) => Boolean(id?.endsWith(':__none__'));

export interface IOverviewGraph {
  nodes: IBaseGraphNode[];
  links: IBaseGraphLink[];
  stats: Pick<IBaseGraphStats, 'perTable' | 'truncated'>;
}

type IValues = Record<string, unknown>;

/** Freshness, the cockpit's: changed within a week, within a month, or older. */
const freshTone = (date: string | undefined, now: Date): ISearchTone => {
  const at = date ? Date.parse(date) : NaN;
  if (Number.isNaN(at)) return 'none';
  const age = (now.getTime() - at) / day;
  return age <= 7 ? 'route' : age <= 30 ? 'target' : 'ink';
};

/** The record's state, its date (the first date field with a value) and the tone they give. */
function lookOf(r: IResolvedTable, values: IValues, now: Date) {
  const { def, fields } = r;
  const state = fields.tone ? cellText(values[fields.tone.id]) || undefined : undefined;
  const dateField = fields.dates.find((f) => values[f.id] != null && values[f.id] !== '');
  const date = dateField ? String(values[dateField.id]) : undefined;
  let tone: ISearchTone = 'none';
  if (def.tone === 'fresh') tone = freshTone(date, now);
  else if (state) tone = def.toneMap ? def.toneMap[state.toLowerCase()] ?? 'none' : toneOf(state);
  return { state, date, dateField, tone };
}

/** A priority select sizes by its words, a number by its magnitude. */
function sizeOf(r: IResolvedTable, values: IValues) {
  const field = r.fields.size;
  const value = field ? values[field.id] : undefined;
  if (!field || value == null) return undefined;
  return field.type.endsWith('Select') ? sizeOfPriority(value) : sizeOfAmount(value);
}

/** Up to four tooltip lines: state, priority, date, amount. */
function metaOf(
  r: IResolvedTable,
  values: IValues,
  look: ReturnType<typeof lookOf>,
  amount?: number
) {
  const { tone, size, money } = r.fields;
  const lines: ([string, string] | undefined)[] = [
    tone && look.state ? [tone.name, look.state] : undefined,
    size && size !== money && values[size.id] != null
      ? [size.name, cellText(values[size.id])]
      : undefined,
    look.dateField && look.date ? [look.dateField.name, look.date.slice(0, 10)] : undefined,
    money && amount !== undefined ? [money.name, String(amount)] : undefined,
  ];
  return lines.filter((l): l is [string, string] => Boolean(l));
}

/** A record's look from its values: tone, state, size, date, amount and tooltip lines. */
function encodeRecord(r: IResolvedTable, node: IBaseGraphNode, now: Date): IOverviewNode {
  const values = node.values ?? {};
  const look = lookOf(r, values, now);
  const size = sizeOf(r, values);
  const amount = r.fields.money ? Number(values[r.fields.money.id]) || 0 : undefined;
  const meta = metaOf(r, values, look, amount);
  return {
    id: node.id,
    kind: r.def.role === 'branch' ? 'hub' : r.def.role,
    label: node.label.slice(0, labelChars) || '(untitled)',
    short: r.def.short,
    parent: null,
    tone: look.tone,
    ...(look.state ? { state: look.state } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(look.date ? { date: look.date } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(node.recordId ? { recordId: node.recordId } : {}),
    tableId: r.table.id,
    table: r.table.name,
    ...(meta.length ? { meta } : {}),
  };
}

const archived = (r: IResolvedTable, node: IBaseGraphNode) =>
  Boolean(r.fields.active && node.values && node.values[r.fields.active.id] !== true);

const hubNode = (id: string, label: string, short: string | null): IOverviewNode => ({
  id,
  kind: 'hub',
  label: label.slice(0, labelChars),
  short,
  parent: null,
  tone: 'none',
});

/**
 * Where a record hangs: actors on their table's hub; a record under its drawn parent; an item
 * with no parent, an empty group cell or a parent not drawn under the table's orphan hub (or
 * nowhere, `skip`, when the dataset draws none); a branch without one stands as a branch.
 */
function parentOf(
  r: IResolvedTable,
  node: IBaseGraphNode,
  drawn: Map<string, IOverviewNode>
): string | null | 'orphan' | 'skip' {
  if (r.def.role === 'actor') return 'orphan';
  if (node.parentId && drawn.has(node.parentId)) return node.parentId;
  if (r.def.role !== 'item' && !isBucket(node.parentId)) return null;
  return r.def.orphan === null ? 'skip' : 'orphan';
}

interface IPlaced {
  nodes: Map<string, IOverviewNode>;
  unplaced: Map<string, number>;
}

/**
 * Base-graph nodes onto the overview's, in emitted order, so a parent is always placed before
 * its children. The bucket of records with an empty group cell becomes the orphan hub.
 */
function place(o: IResolvedOverview, graph: IOverviewGraph, now: Date): IPlaced {
  const byTable = new Map(o.tables.map((r) => [r.table.id, r]));
  const placed: IPlaced = { nodes: new Map(), unplaced: new Map() };
  for (const node of graph.nodes) {
    const r = node.tableId ? byTable.get(node.tableId) : undefined;
    if (!r) continue;
    if (node.kind === 'group' && !isBucket(node.id))
      placed.nodes.set(node.id, hubNode(node.id, node.label, null));
    else if (node.kind === 'record' && !archived(r, node)) placeRecord(placed, r, node, now);
  }
  return placed;
}

/** The table's hub for its orphans and actors, made on first use. */
function orphanHub(nodes: Map<string, IOverviewNode>, r: IResolvedTable) {
  const id = hubOf(r.table.id);
  const label = r.def.orphan ?? r.table.name;
  if (!nodes.has(id)) nodes.set(id, hubNode(id, label, label));
  return id;
}

function placeRecord(placed: IPlaced, r: IResolvedTable, node: IBaseGraphNode, now: Date) {
  const parent = parentOf(r, node, placed.nodes);
  if (parent === 'skip') {
    placed.unplaced.set(r.table.name, (placed.unplaced.get(r.table.name) ?? 0) + 1);
    return;
  }
  const own = encodeRecord(r, node, now);
  own.parent = parent === 'orphan' ? orphanHub(placed.nodes, r) : parent;
  placed.nodes.set(own.id, own);
}

/** Goals have no status: one whose work is all settled is settled; a passed deadline alerts. */
function alerts(o: IResolvedOverview, nodes: Map<string, IOverviewNode>, now: Date) {
  const work = new Map<string, IOverviewNode[]>();
  for (const n of nodes.values())
    if (n.parent && n.kind === 'item') work.set(n.parent, [...(work.get(n.parent) ?? []), n]);
  const defOf = new Map(o.tables.map((r) => [r.table.id, r.def]));
  const done = (n: IOverviewNode, byChildren?: boolean) => {
    const under = work.get(n.id) ?? [];
    return (
      settled(n.tone) || Boolean(byChildren && under.length && under.every((k) => settled(k.tone)))
    );
  };
  for (const n of nodes.values()) {
    const def = n.tableId ? defOf.get(n.tableId) : undefined;
    const late = Boolean(def?.dueAlert && n.date && Date.parse(n.date) < now.getTime());
    if (late && !done(n, def?.settledByChildren)) n.alert = true;
  }
}

/** Edges of the link fields the dataset draws. */
const drawnLinks = (o: IResolvedOverview, graph: IOverviewGraph) =>
  graph.links.filter((l) => l.kind === 'link' && l.fieldId && o.edgeNames[l.fieldId]);

/** Satellites (pruned tables) stay only when an edge reaches a record of a table not pruned. */
function pruneSatellites(
  o: IResolvedOverview,
  graph: IOverviewGraph,
  nodes: Map<string, IOverviewNode>
) {
  const pruned = new Set(o.tables.filter((r) => r.def.prune).map((r) => r.table.id));
  const core = (id: string) => {
    const tableId = nodes.get(id)?.tableId;
    return Boolean(tableId && !pruned.has(tableId));
  };
  const reached = new Set<string>();
  for (const l of drawnLinks(o, graph)) {
    if (core(l.source)) reached.add(l.target);
    if (core(l.target)) reached.add(l.source);
  }
  for (const n of [...nodes.values()])
    if (n.tableId && pruned.has(n.tableId) && n.recordId && !reached.has(n.id)) nodes.delete(n.id);
}

/** Hubs with nothing under them go; a table drawn even when empty holds its hubs up. */
function dropEmptyHubs(o: IResolvedOverview, nodes: Map<string, IOverviewNode>) {
  const kept = new Set(o.tables.filter((r) => r.def.keepEmpty).map((r) => r.table.id));
  const content = (n: IOverviewNode) =>
    n.kind !== 'hub' || Boolean(n.tableId && kept.has(n.tableId));
  const filled = new Set<string>();
  for (const n of nodes.values()) {
    if (!content(n)) continue;
    for (let p = n.parent; p && !filled.has(p); p = nodes.get(p)?.parent ?? null) filled.add(p);
  }
  for (const n of [...nodes.values()]) if (!content(n) && !filled.has(n.id)) nodes.delete(n.id);
}

function linksOf(o: IResolvedOverview, graph: IOverviewGraph, nodes: Map<string, IOverviewNode>) {
  const out: IOverviewLink[] = [];
  const seen = new Set<string>();
  for (const l of drawnLinks(o, graph)) {
    const a = nodes.get(l.source);
    const b = nodes.get(l.target);
    const id = a && b ? [a.id, b.id].sort().join('|') : '';
    if (!a || !b || a.id === b.id || seen.has(id)) continue;
    seen.add(id);
    const item = [a, b].find((n) => n.kind === 'item') ?? a;
    const tone = item.tone === 'none' ? 'target' : item.tone;
    out.push({ id, source: a.id, target: b.id, tone, label: o.edgeNames[l.fieldId!] });
  }
  return out;
}

/**
 * One dataset's base graph as the overview draws it (overview design §8.4). Pure: the same
 * graph and the same moment always give the same overview.
 */
export function encodeOverview(
  o: IResolvedOverview,
  graph: IOverviewGraph,
  now = new Date()
): Omit<IAgentOverviewVo, 'builtAt'> {
  const { nodes, unplaced } = place(o, graph, now);
  alerts(o, nodes, now);
  pruneSatellites(o, graph, nodes);
  dropEmptyHubs(o, nodes);
  const counts: Record<string, number> = {};
  for (const n of nodes.values())
    if (n.recordId && n.table) counts[n.table] = (counts[n.table] ?? 0) + 1;
  for (const [table, n] of unplaced) counts[`${table}.unplaced`] = n;
  return {
    dataset: o.dataset.id,
    title: o.dataset.title,
    path: o.dataset.path,
    baseId: o.baseId,
    nodes: [...nodes.values()],
    links: linksOf(o, graph, nodes),
    counts,
    missing: o.missing,
    truncated: graph.stats.truncated.nodes || graph.stats.perTable.some((t) => t.truncated),
  };
}
