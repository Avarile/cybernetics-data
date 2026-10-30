/* The constellation's layout, ported from the ai-cockpit's tree.ts: the graph's parents form
   one tree under a root; BUNDLE lays it out with d3.cluster and routes each link through the
   tree (curveBundle), TREE uses d3.tree and draws the structure itself. Pure: positions and
   path strings out, the view draws them. */
import { cluster, hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { curveBundle, lineRadial, linkRadial } from 'd3-shape';
import type { IGLink, IGNode, IGraph, ITone } from './types';

export type ILayoutMode = 'bundle' | 'tree';
const TAU = Math.PI * 2;
const ORDER: Record<ITone, number> = {
  ink: 0,
  route: 1,
  target: 2,
  caution: 3,
  dim: 4,
  faint: 5,
  none: 6,
};
const KIND: Record<IGNode['kind'], number> = { hub: 0, item: 1, actor: 2 };

interface IDatum {
  id: string;
  node: IGNode | null;
  /** Drawn faint: an ancestor kept only to place the lens records. */
  context: boolean;
  children?: IDatum[];
}
type IPoint = HierarchyPointNode<IDatum>;

export interface ILaidNode {
  id: string;
  node: IGNode | null;
  x: number;
  y: number;
  /** Angle in radians (0 at the top, clockwise) and radius. */
  angle: number;
  radius: number;
  depth: number;
  leaf: boolean;
  context: boolean;
}
export interface ILaidEdge {
  id: string;
  link: IGLink;
  d: string;
}
export interface ILayout {
  nodes: ILaidNode[];
  /** Parent-child lines (TREE) */
  branches: { id: string; d: string; tone: ITone }[];
  edges: ILaidEdge[];
  radius: number;
}

function buildTree(g: IGraph, lens: Set<string> | null): IDatum {
  const order = (a: IGNode, b: IGNode) =>
    KIND[a.kind] - KIND[b.kind] || ORDER[a.tone] - ORDER[b.tone] || a.label.localeCompare(b.label);
  const seen = new Set<string>();
  const visit = (n: IGNode): IDatum | null => {
    if (seen.has(n.id)) return null; // guards against parent loops
    seen.add(n.id);
    const children = (g.kids.get(n.id) ?? [])
      .slice()
      .sort(order)
      .map(visit)
      .filter((x): x is IDatum => Boolean(x));
    // under a lens a branch stays only for what it cites: no empty spokes
    const self = !lens || lens.has(n.id);
    if (!self && !children.length) return null;
    return {
      id: n.id,
      node: n,
      context: Boolean(lens && !lens.has(n.id)),
      children: children.length ? children : undefined,
    };
  };
  const roots = g.nodes
    .filter((n) => !n.parent || !g.byId.has(n.parent))
    .sort(order)
    .map(visit)
    .filter((x): x is IDatum => Boolean(x));
  return { id: 'root', node: null, context: false, children: roots.length ? roots : undefined };
}

/** Positions for a chart of outer radius `r`, turned by `rotation` radians. */
export function layoutGraph(
  g: IGraph,
  options: { mode: ILayoutMode; radius: number; lens?: Set<string> | null; rotation?: number }
): ILayout {
  const rot = options.rotation ?? 0;
  const root = hierarchy(buildTree(g, options.lens ?? null));
  const margin = Math.max(60, Math.min(160, options.radius * 0.32));
  const inner = Math.max(40, options.radius - margin);
  const separation = (a: IPoint, b: IPoint) => {
    const base = a.parent === b.parent ? 1 : 2;
    const actor = a.data.node?.kind === 'actor' || b.data.node?.kind === 'actor' ? 1.6 : 1;
    return (base * actor) / (options.mode === 'tree' ? Math.max(1, Math.min(a.depth, 3)) : 1);
  };
  const laid = (options.mode === 'tree' ? tree<IDatum>() : cluster<IDatum>())
    .size([TAU, inner])
    .separation(separation)(root);
  const angle = (d: IPoint) => d.x + rot;
  const nodes: ILaidNode[] = laid.descendants().map((d) => ({
    id: d.data.id,
    node: d.data.node,
    angle: ((angle(d) % TAU) + TAU) % TAU,
    radius: d.y,
    x: d.y * Math.sin(angle(d)),
    y: -d.y * Math.cos(angle(d)),
    depth: d.depth,
    leaf: !d.children,
    context: d.data.context,
  }));
  const byId = new Map(laid.descendants().map((d) => [d.data.id, d]));
  const branches =
    options.mode === 'tree'
      ? laid.links().map((l) => ({
          id: `${l.source.data.id}>${l.target.data.id}`,
          d:
            linkRadial<typeof l, IPoint>()
              .angle(angle)
              .radius((d) => d.y)(l) ?? '',
          tone: l.target.data.node?.tone ?? 'none',
        }))
      : [];
  const bundle = lineRadial<IPoint>()
    .curve(curveBundle.beta(0.85))
    .radius((d) => d.y)
    .angle(angle);
  const edges: ILaidEdge[] = g.links.flatMap((link) => {
    const a = byId.get(link.source);
    const b = byId.get(link.target);
    if (!a || !b) return [];
    return [{ id: link.id, link, d: bundle(a.path(b)) ?? '' }];
  });
  return { nodes, branches, edges, radius: inner };
}

/** Text placement that stays readable: labels on the left half are flipped. */
export function labelTransform(n: ILaidNode, offset: number) {
  const deg = (n.angle * 180) / Math.PI - 90;
  const flip = n.angle > Math.PI;
  return {
    transform: `rotate(${deg}) translate(${n.radius + offset},0)${flip ? ' rotate(180)' : ''}`,
    anchor: flip ? 'end' : 'start',
  } as const;
}

export const nodeRadius = (n: IGNode | null) =>
  2.3 + Math.max(0, Math.min(4, Number(n?.size) || 0)) * 0.55;
