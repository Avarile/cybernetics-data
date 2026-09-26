import type { IBaseGraphNode } from '@teable/openapi';
import { BASE_NODE_ID } from '@teable/openapi';
import { applyBudget } from './budget';
import { buildLinkEdges } from './edges';
import { buildStructure, resolveDepthAndColor } from './structure';
import type { IAssembledBaseGraph, IAssemblerPlan, ITableRows } from './types';

/**
 * Rows of every table → the graph. Pure: the only place graph shape is decided,
 * and the one worth unit-testing. No Nest, no I/O.
 */
export const assembleBaseGraph = (
  plan: IAssemblerPlan,
  rowsByTable: ReadonlyMap<string, ITableRows>
): IAssembledBaseGraph => {
  const budgeted = applyBudget(plan, rowsByTable);
  const emittedIds = new Set<string>();
  for (const { rows } of budgeted.values()) {
    for (const row of rows) {
      emittedIds.add(row.recordId);
    }
  }

  const structure = buildStructure(plan, budgeted, emittedIds);
  const edges = buildLinkEdges(
    plan.tables,
    budgeted,
    emittedIds,
    plan.maxLinks - structure.links.length
  );

  // A table is drawn as a tree when it has its own hierarchy, groups its roots,
  // or is the group target of another table — the last so a group record and
  // the records bucketed under it share one colour family.
  const treeTables = new Set<string>();
  for (const table of plan.tables) {
    if (table.hierarchyFieldId || table.groupFieldId) treeTables.add(table.tableId);
    if (table.groupTargetTableId) treeTables.add(table.groupTargetTableId);
  }
  const placement = resolveDepthAndColor(structure.nodes, treeTables);

  const childCount = new Map<string, number>();
  for (const node of structure.nodes) {
    if (node.parentId) {
      childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
    }
  }

  // Degree = every adjacent edge except the one to the base hub, which the
  // client never draws: children, own parent, and every link pair.
  const nodes: IBaseGraphNode[] = structure.nodes.map((node) => {
    const own = node.parentId && node.parentId !== BASE_NODE_ID ? 1 : 0;
    const links = node.recordId ? edges.linkDegree.get(node.recordId) ?? 0 : 0;
    const { depth, colorKey } = placement.get(node.id) ?? { depth: 0, colorKey: null };
    return { ...node, depth, colorKey, degree: (childCount.get(node.id) ?? 0) + own + links };
  });

  const links = [...structure.links, ...edges.links];
  const nodeTruncated = [...budgeted.values()].some((t) => t.truncated);

  return {
    nodes,
    links,
    stats: {
      perTable: plan.tables.map((table) => ({
        tableId: table.tableId,
        emitted: budgeted.get(table.tableId)?.rows.length ?? 0,
        truncated: budgeted.get(table.tableId)?.truncated ?? false,
      })),
      nodeCount: nodes.length,
      linkCount: links.length,
      truncated: { nodes: nodeTruncated, links: edges.truncated },
      cyclesDropped: structure.cyclesDropped,
      danglingLinks: edges.danglingLinks,
      groupOrphans: structure.groupOrphans,
    },
  };
};
