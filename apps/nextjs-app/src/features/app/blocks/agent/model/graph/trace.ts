import { linkedTo, type IGraph } from './types';

/**
 * What a node lights on a chart with no board behind it (the overview, design §7): its branch up
 * to the root, its children, and the nodes its edges reach.
 */
export function traceGraph(g: IGraph, id: string): Set<string> {
  const out = new Set<string>();
  if (!g.byId.has(id)) return out;
  for (let p: string | null = id; p && !out.has(p); p = g.byId.get(p)?.parent ?? null) out.add(p);
  for (const kid of g.kids.get(id) ?? []) out.add(kid.id);
  for (const other of linkedTo(g, id)) out.add(other);
  return out;
}
