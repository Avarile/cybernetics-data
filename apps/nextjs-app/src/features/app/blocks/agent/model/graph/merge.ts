import type { IOverviewGraphVo, IOverviewNode } from '@teable/openapi';

/**
 * Forced records the overview did not read, added to it (scope design §7.3): nodes it already
 * has are kept as they are; a node whose parent is nowhere hangs from its table's hub, else from
 * the core. Pure.
 */
export function mergeNodes<T extends Pick<IOverviewGraphVo, 'nodes'>>(
  vo: T,
  extra: IOverviewNode[]
): T {
  if (!extra.length) return vo;
  const ids = new Set(vo.nodes.map((n) => n.id));
  const added = extra.filter((n) => !ids.has(n.id));
  if (!added.length) return vo;
  const all = new Set([...ids, ...added.map((n) => n.id)]);
  const placed = added.map((n) => {
    if (!n.parent || all.has(n.parent)) return n;
    const hub = n.tableId ? `hub:${n.tableId}` : undefined;
    return { ...n, parent: hub && all.has(hub) ? hub : null };
  });
  return { ...vo, nodes: [...vo.nodes, ...placed] };
}
