import { linkedTo, type IGraph } from './types';

/** `id` and the branch above it up to the root. */
const withAncestors = (g: IGraph, id: string, out: Set<string>) => {
  for (let p: string | null = id; p && !out.has(p); p = g.byId.get(p)?.parent ?? null) out.add(p);
};

/** `id` and everything under it. */
const subtree = (g: IGraph, id: string, out: Set<string>) => {
  const stack = [id];
  while (stack.length) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    for (const kid of g.kids.get(next) ?? []) stack.push(kid.id);
  }
};

/**
 * What a node lights on a chart with no board behind it (the overview, design §7), as the
 * ai-cockpit's focusOf does: a person, their edges with both ends and the branches above them;
 * anything else, its whole subtree, the edges from it, and the branch above it.
 */
export function traceGraph(g: IGraph, id: string): Set<string> {
  const node = g.byId.get(id);
  const out = new Set<string>();
  if (!node) return out;
  const from = new Set<string>();
  if (node.kind === 'actor') from.add(id);
  else subtree(g, id, from);
  // the far end of each edge with its branch (the bundle runs up through it); the near end's
  // branch is this node's own, added last
  const lit = new Set(from);
  for (const one of from) for (const other of linkedTo(g, one)) withAncestors(g, other, lit);
  withAncestors(g, id, out);
  for (const x of lit) out.add(x);
  return out;
}
