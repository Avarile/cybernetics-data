/* The constellation's render budget, ported from the ai-cockpit's limit.ts: the chart draws at
   most about 900 nodes plus links, most relevant records first (alerts, active, large, recent);
   the rest fold into one "+N more" marker per parent. Under the answer's lens only its records
   compete for the budget. Pure. */
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

/**
 * Records kept, most relevant first, while their nodes and links fit the budget. The first
 * `forced` of the ranked are kept whatever they cost.
 */
function chooseKept(
  g: IGraph,
  ranked: IGNode[],
  budget: number,
  lens: Set<string> | null,
  forced = 0
) {
  // hubs and people always draw; under a lens only those it cites, with their branch
  const keep = new Set<string>(
    g.nodes
      .filter((n) => n.kind !== 'item' && (!lens || lens.has(n.id)))
      .flatMap((n) => chainOf(g, n.id))
  );
  let spent = keep.size;
  for (const [i, n] of ranked.entries()) {
    const chain = chainOf(g, n.id).filter((id) => !keep.has(id));
    const touches = (l: IGLink) =>
      (l.source === n.id && keep.has(l.target)) || (l.target === n.id && keep.has(l.source));
    const cost = chain.length + g.links.filter(touches).length;
    if (i >= forced && spent + cost > budget && keep.size > 1) break;
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

export interface ILimitOptions {
  /** Record ids the answer cites: only they are candidates, as only they are drawn. */
  lens?: Set<string> | null;
  /** Most nodes plus links to draw. */
  budget?: number;
  now?: number;
  /**
   * Node ids drawn whatever the budget (scope design §7.3: the forced search results), with
   * their branch; the least relevant of the rest make room for them.
   */
  must?: Set<string> | null;
}

export function limitGraph(
  g: IGraph,
  { lens = null, budget = SAFE_DRAW, now = Date.now(), must = null }: ILimitOptions = {}
): ILimited {
  const items = g.nodes.filter(
    (n) => n.kind === 'item' && !n.overflow && (!lens || lens.has(n.id))
  );
  const total = items.length;
  if (g.nodes.length + g.links.length <= budget)
    return { graph: g, total, shown: total, hidden: 0 };
  const byRelevance = items
    .map((n) => ({ n, s: relevance(n, now) }))
    .sort((a, b) => b.s - a.s || (a.n.id < b.n.id ? -1 : 1))
    .map((x) => x.n);
  const forced = byRelevance.filter((n) => must?.has(n.id));
  const ranked = [...forced, ...byRelevance.filter((n) => !must?.has(n.id))];
  // room for the "+N more" markers: one per parent that may lose records (none under a lens,
  // which draws only its own records, so a marker would never show)
  const reserve = lens
    ? 0
    : Math.min(new Set(items.map((n) => n.parent)).size, Math.floor(budget / 10));
  const keep = chooseKept(g, ranked, budget - reserve, lens, forced.length);
  const shown = ranked.filter((n) => keep.has(n.id)).length;
  const graph = reduced(g, keep, lens ? [] : ranked.filter((n) => !keep.has(n.id)));
  return { graph, total, shown, hidden: total - shown };
}
