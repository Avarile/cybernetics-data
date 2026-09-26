import type { IBaseGraphLink, IBaseGraphNode } from '@teable/openapi';
import { BASE_NODE_ID, groupNodeId, recordNodeId, tableNodeId } from '@teable/openapi';
import { breakCycles, orderDepthFirst } from '../hierarchy';
import type { IBudgetedTable } from './budget';
import type { IAssemblerPlan, IAssemblerTable, IGraphRow } from './types';

/** A node before degree is known — degree needs the link pass. */
export type IStructuralNode = Omit<IBaseGraphNode, 'degree' | 'depth' | 'colorKey'>;

export interface IStructure {
  nodes: IStructuralNode[];
  /** Exactly one per node that has a parent, parent → child. */
  links: IBaseGraphLink[];
  cyclesDropped: number;
  groupOrphans: number;
}

const isHubId = (id: string) => id === BASE_NODE_ID || id.startsWith('tbl:');

/**
 * Where a node with no parent of its own kind hangs: its table hub when hubs are
 * on, otherwise the base hub when that is on, otherwise nowhere.
 */
const hubParentOf = (plan: IAssemblerPlan, tableId: string): string | null => {
  if (plan.showTableHubs) {
    return tableNodeId(tableId);
  }
  return plan.showBaseHub ? BASE_NODE_ID : null;
};

/**
 * Tables whose group target is another included table must come after it, so a
 * group record node is always emitted before the records bucketed under it.
 * Stable: ties keep plan order. The resolver rejects group cycles, so this
 * terminates; the `visiting` guard only protects against a resolver regression.
 */
export const orderTablesByGroupDependency = (tables: IAssemblerTable[]): IAssemblerTable[] => {
  const byId = new Map(tables.map((t) => [t.tableId, t]));
  const out: IAssemblerTable[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (table: IAssemblerTable) => {
    if (done.has(table.tableId) || visiting.has(table.tableId)) {
      return;
    }
    visiting.add(table.tableId);
    const target = table.groupTargetTableId ? byId.get(table.groupTargetTableId) : undefined;
    if (target) {
      visit(target);
    }
    visiting.delete(table.tableId);
    done.add(table.tableId);
    out.push(table);
  };
  tables.forEach(visit);
  return out;
};

interface ITableContext {
  plan: IAssemblerPlan;
  table: IAssemblerTable;
  rows: IGraphRow[];
  emittedIds: ReadonlySet<string>;
}

/**
 * The structural parent of a ROOT record (no hierarchy parent): its group record
 * when that table is in the graph, a synthetic group node when it is not, the
 * "none" bucket when the cell is empty or points outside the emitted set, or a
 * hub when no group field is configured.
 */
const rootParentOf = (
  ctx: ITableContext,
  row: IGraphRow
): { parentId: string | null; kind: IBaseGraphLink['kind']; orphan: boolean } => {
  const { plan, table, emittedIds } = ctx;
  if (!table.groupFieldId) {
    const hub = hubParentOf(plan, table.tableId);
    return { parentId: hub, kind: 'hub', orphan: false };
  }
  if (row.group && table.groupTargetTableId && emittedIds.has(row.group.recordId)) {
    return { parentId: recordNodeId(row.group.recordId), kind: 'group', orphan: false };
  }
  if (row.group && !table.groupTargetTableId) {
    return {
      parentId: groupNodeId(table.groupFieldId, row.group.recordId),
      kind: 'group',
      orphan: false,
    };
  }
  return { parentId: groupNodeId(table.groupFieldId, null), kind: 'group', orphan: true };
};

const linkFieldFor = (table: IAssemblerTable, kind: IBaseGraphLink['kind']): string | null => {
  if (kind === 'group') return table.groupFieldId;
  if (kind === 'hierarchy') return table.hierarchyFieldId;
  return null;
};

interface IPlacement {
  parentId: string | null;
  kind: IBaseGraphLink['kind'];
  orphan: boolean;
  /** Set when the parent is a synthetic group node that must be emitted. */
  syntheticLabel: string | null;
}

/** Hierarchy parent first; only a root falls through to group or hub. */
const placeRecord = (
  ctx: ITableContext,
  row: IGraphRow,
  hierarchyParent: string | null
): IPlacement => {
  if (hierarchyParent !== null) {
    return {
      parentId: recordNodeId(hierarchyParent),
      kind: 'hierarchy',
      orphan: false,
      syntheticLabel: null,
    };
  }
  const root = rootParentOf(ctx, row);
  if (!root.parentId?.startsWith('grp:')) {
    return { ...root, syntheticLabel: null };
  }
  return {
    ...root,
    syntheticLabel: root.orphan ? ctx.plan.unclassifiedLabel : row.group?.title ?? '',
  };
};

/**
 * Synthetic group nodes, so every parent precedes its children. Real groups
 * sort by title; the "none" bucket goes last, as the unclassified type did.
 */
const syntheticGroupNodes = (
  plan: IAssemblerPlan,
  tableId: string,
  groups: ReadonlyMap<string, string>
): { nodes: IStructuralNode[]; links: IBaseGraphLink[] } => {
  const entries = [...groups.entries()].sort(([aId, aLabel], [bId, bLabel]) => {
    const aNone = aId.endsWith(':__none__');
    const bNone = bId.endsWith(':__none__');
    if (aNone !== bNone) return aNone ? 1 : -1;
    return aLabel.localeCompare(bLabel) || aId.localeCompare(bId);
  });
  const parentId = hubParentOf(plan, tableId);
  return {
    nodes: entries.map(([id, label]) => ({
      id,
      kind: 'group',
      tableId,
      recordId: null,
      label,
      parentId,
    })),
    links: parentId
      ? entries.map(([id]) => ({ source: parentId, target: id, kind: 'hub', fieldId: null }))
      : [],
  };
};

/** Nodes and structural links for one table: synthetic groups, then records depth-first. */
const buildTable = (ctx: ITableContext) => {
  const { plan, table, rows } = ctx;
  let groupOrphans = 0;

  const hierarchyRows = table.hierarchyFieldId
    ? rows
    : rows.map((row) => ({ ...row, parentRecordId: null }));
  // `rows` is already sorted with byTitleThenId by applyBudget — the ordering
  // breakCycles requires — and is the POST-budget set, so a parent cut by the
  // budget resolves to null and its child becomes a root.
  const { parentOf, cyclesDropped } = breakCycles(hierarchyRows);
  const ordered = orderDepthFirst(hierarchyRows, parentOf);

  const recordNodes: IStructuralNode[] = [];
  const recordLinks: IBaseGraphLink[] = [];
  const syntheticGroups = new Map<string, string>();

  for (const row of ordered) {
    const id = recordNodeId(row.recordId);
    const placed = placeRecord(ctx, row, parentOf.get(row.recordId) ?? null);
    if (placed.orphan) groupOrphans++;
    if (
      placed.parentId &&
      placed.syntheticLabel !== null &&
      !syntheticGroups.has(placed.parentId)
    ) {
      syntheticGroups.set(placed.parentId, placed.syntheticLabel);
    }
    recordNodes.push({
      id,
      kind: 'record',
      tableId: table.tableId,
      recordId: row.recordId,
      label: row.title,
      parentId: placed.parentId,
    });
    if (placed.parentId) {
      recordLinks.push({
        source: placed.parentId,
        target: id,
        kind: placed.kind,
        fieldId: linkFieldFor(table, placed.kind),
      });
    }
  }

  const groups = syntheticGroupNodes(plan, table.tableId, syntheticGroups);
  const nodes: IStructuralNode[] = [...groups.nodes];
  const links: IBaseGraphLink[] = [...groups.links];
  nodes.push(...recordNodes);
  links.push(...recordLinks);
  return { nodes, links, cyclesDropped, groupOrphans };
};

/**
 * Every node and structural edge, parents before children. Exactly one
 * structural parent per node: hierarchy parent › group › hub › none.
 */
export const buildStructure = (
  plan: IAssemblerPlan,
  budgeted: ReadonlyMap<string, IBudgetedTable>,
  emittedIds: ReadonlySet<string>
): IStructure => {
  const nodes: IStructuralNode[] = [];
  const links: IBaseGraphLink[] = [];
  let cyclesDropped = 0;
  let groupOrphans = 0;

  if (plan.showBaseHub) {
    nodes.push({
      id: BASE_NODE_ID,
      kind: 'base',
      tableId: null,
      recordId: null,
      label: plan.baseLabel,
      parentId: null,
    });
  }
  if (plan.showTableHubs) {
    for (const table of plan.tables) {
      const id = tableNodeId(table.tableId);
      const parentId = plan.showBaseHub ? BASE_NODE_ID : null;
      nodes.push({
        id,
        kind: 'table',
        tableId: table.tableId,
        recordId: null,
        label: table.name,
        parentId,
      });
      if (parentId) {
        links.push({ source: parentId, target: id, kind: 'hub', fieldId: null });
      }
    }
  }

  for (const table of orderTablesByGroupDependency(plan.tables)) {
    const rows = budgeted.get(table.tableId)?.rows ?? [];
    const built = buildTable({ plan, table, rows, emittedIds });
    nodes.push(...built.nodes);
    links.push(...built.links);
    cyclesDropped += built.cyclesDropped;
    groupOrphans += built.groupOrphans;
  }

  return { nodes, links, cyclesDropped, groupOrphans };
};

/**
 * Depth = number of non-hub structural ancestors. colorKey = the top-most
 * non-hub ancestor-or-self for tables drawn as a tree (hierarchy or group),
 * otherwise the table hub id, so a flat table reads as one hue family.
 *
 * Walks with a `seen` guard: group edges cross tables, and although the
 * resolver rejects cross-table group cycles, this is the one place a
 * regression there would hang a request.
 */
export const resolveDepthAndColor = (
  nodes: readonly IStructuralNode[],
  treeTables: ReadonlySet<string>
): Map<string, { depth: number; colorKey: string | null }> => {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { depth: number; colorKey: string | null }>();

  for (const node of nodes) {
    if (node.kind === 'base') {
      out.set(node.id, { depth: 0, colorKey: null });
      continue;
    }
    if (node.kind === 'table') {
      out.set(node.id, { depth: 0, colorKey: node.id });
      continue;
    }
    let depth = 0;
    let top = node.id;
    const seen = new Set<string>([node.id]);
    let current = parentOf.get(node.id) ?? null;
    while (current && !isHubId(current) && !seen.has(current) && byId.has(current)) {
      seen.add(current);
      depth++;
      top = current;
      current = parentOf.get(current) ?? null;
    }
    const isTree = node.kind === 'group' || (node.tableId !== null && treeTables.has(node.tableId));
    const colorKey = isTree || top !== node.id ? top : tableNodeId(node.tableId as string);
    out.set(node.id, { depth, colorKey });
  }
  return out;
};
