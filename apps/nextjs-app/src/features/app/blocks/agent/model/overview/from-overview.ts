import type { IOverviewGraphVo } from '@teable/openapi';
import { finishGraph, type IGNode, type IGraph } from '../graph/types';

/**
 * A table's overview as the constellation's graph (overview design §9.1). The server
 * already encoded every node, so this only adapts the shape.
 */
export function overviewToGraph(vo: Pick<IOverviewGraphVo, 'title' | 'nodes' | 'links'>): IGraph {
  const nodes: IGNode[] = vo.nodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    // a record's short is its table's kind ("TASK"), not a key: on a crowded ring every label
    // would read the same, so records go by name and the tooltip names the table
    short: n.recordId ? null : n.short,
    parent: n.parent,
    tone: n.tone,
    ...(n.alert ? { alert: true } : {}),
    ...(n.size !== undefined ? { size: n.size } : {}),
    ...(n.amount !== undefined ? { amount: n.amount } : {}),
    ...(n.date ? { date: Date.parse(n.date) } : {}),
    ...(n.state ? { state: n.state.toUpperCase() } : {}),
    ...(n.table ? { table: n.table } : {}),
    ...(n.recordId ? { recordId: n.recordId } : {}),
    ...(n.tableId ? { tableId: n.tableId } : {}),
    ...(n.meta ? { meta: n.meta } : {}),
  }));
  return finishGraph({ title: vo.title, nodes, links: vo.links });
}
