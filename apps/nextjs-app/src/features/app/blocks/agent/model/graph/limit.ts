/* The constellation's render budget, ported from the ai-cockpit's limit.ts: the chart draws at
   most about 900 nodes plus links, most relevant records first (the lens, alerts, active, large,
   recent); the rest fold into one "+N more" marker per parent. Pure. */
import { finishGraph, type IGLink, type IGNode, type IGraph, type ITone } from './types';

export const SAFE_DRAW = 900;
const DAY = 864e5;
const TONE_SCORE: Record<ITone, number> = {
  route: 40,
  caution: 35,
  target: 25,
  dim: 8,
  none: 5,
  ink: 0,
  faint: -10,
};

export interface ILimited {
  graph: IGraph;
  total: number;
  shown: number;
  hidden: number;
}

export function relevance(n: IGNode, now: number): number {
  const age = n.date != null ? Math.max(0, now - n.date) : Infinity;
  return (
    (n.alert ? 100 : 0) +
    TONE_SCORE[n.tone] +
    (Number(n.size) || 0) * 6 +
    (Number.isFinite(age) ? 30 * Math.exp(-age / (30 * DAY)) : 0)
  );
}

/** Ancestors of `id` (itself first) that are in the graph. */
const chainOf = (g: IGraph, id: string) => {
  const out: string[] = [];
  for (
    let p: string | null | undefined = id;
    p && g.byId.has(p) && !out.includes(p);
    p = g.byId.get(p)!.parent
  ) {
    out.push(p);
  }
  return out;
};

/** Records kept, most relevant first, while their nodes and links fit the budget. */
function chooseKept(g: IGraph, ranked: IGNode[], budget: number) {
  const keep = new Set<string>(g.nodes.filter((n) => n.kind !== 'item').map((n) => n.id));
  let spent = keep.size;
  for (const n of ranked) {
    const chain = chainOf(g, n.id).filter((id) => !keep.has(id));
    const touches = (l: IGLink) =>
      (l.source === n.id && keep.has(l.target)) || (l.target === n.id && keep.has(l.source));
    const cost = chain.length + g.links.filter(touches).length;
    if (spent + cost > budget && keep.size > 1) break;
    chain.forEach((id) => keep.add(id));
    spent += cost;
  }
  return keep;
}

/** The graph of the kept nodes, with one "+N more" marker per parent that lost records. */
function reduced(g: IGraph, keep: Set<string>, dropped: IGNode[]): IGraph {
  const nodes = g.nodes.filter((n) => keep.has(n.id));
  const folded = new Map<string, number>();
  for (const n of dropped)
    if (n.parent && keep.has(n.parent)) folded.set(n.parent, (folded.get(n.parent) ?? 0) + 1);
  for (const [parent, count] of folded) {
    nodes.push({
      id: `more:${parent}`,
      kind: 'item',
      overflow: true,
      label: `+${count} more`,
      short: null,
      parent,
      tone: 'none',
      size: 0,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  return finishGraph({
    title: g.title,
    nodes,
    links: g.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
  });
}

export function limitGraph(g: IGraph, budget = SAFE_DRAW, now = Date.now()): ILimited {
  const items = g.nodes.filter((n) => n.kind === 'item' && !n.overflow);
  const total = items.length;
  if (g.nodes.length + g.links.length <= budget)
    return { graph: g, total, shown: total, hidden: 0 };
  const ranked = items
    .map((n) => ({ n, s: relevance(n, now) }))
    .sort((a, b) => b.s - a.s || (a.n.id < b.n.id ? -1 : 1))
    .map((x) => x.n);
  // room for the "+N more" markers: one per parent that may lose records
  const reserve = Math.min(new Set(items.map((n) => n.parent)).size, Math.floor(budget / 10));
  const keep = chooseKept(g, ranked, budget - reserve);
  const shown = ranked.filter((n) => keep.has(n.id)).length;
  const graph = reduced(
    g,
    keep,
    ranked.filter((n) => !keep.has(n.id))
  );
  return { graph, total, shown, hidden: total - shown };
}
