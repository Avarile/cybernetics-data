/* The constellation's tree and geometry, ported from the ai-cockpit's tree.ts: the graph's
   parents form one tree under a root; BUNDLE lays it out with d3.cluster, TREE with d3.tree.
   Pure (d3-hierarchy computes, nothing is drawn): the D3 chart in ui/stage draws from this. */
import { cluster, hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import type { IGNode, IGraph, ITone } from './types';

export type ILayoutMode = 'bundle' | 'tree';
export const TAU = Math.PI * 2;
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

/** The point every branch grows from. */
export interface IRootNode {
  id: 'root';
  kind: 'root';
  label: string;
  short: null;
  tone: ITone;
  size?: number;
  alert?: boolean;
  overflow?: boolean;
}
export type ITreeNode = IGNode | IRootNode;

export interface IDatum {
  id: string;
  node: ITreeNode;
  /** Drawn faint: an ancestor kept only to place the lens records. */
  context: boolean;
  children?: IDatum[];
}
export type IPoint = HierarchyPointNode<IDatum>;

/** The tree of a graph; under a lens, only what it cites and the branches above it. */
export function buildTree(g: IGraph, lens: Set<string> | null): IDatum {
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
  return {
    id: 'root',
    node: { id: 'root', kind: 'root', label: g.title, short: null, tone: 'none' },
    context: false,
    children: roots.length ? roots : undefined,
  };
}

/** Where the chart sits in a box of `width` × `height` with `leaves` on its rim. */
export interface IGeometry {
  cx: number;
  cy: number;
  /** Outer radius: the rims sit just inside it. */
  r: number;
  /** Radius of the leaves; the band beyond is for their labels. */
  rIn: number;
  margin: number;
  narrow: boolean;
}

/** The cockpit's centre() and geo(): room for full names only when the ring can show them. */
export function geometry(width: number, height: number, leaves: number): IGeometry {
  const r = Math.max(80, Math.min(height / 2 - 18, width / 2 - 26));
  const narrow = width < 620;
  const fontAt = (m: number) => ((TAU * Math.max(50, r - m)) / Math.max(1, leaves)) * 0.9;
  let margin = narrow ? 30 : Math.max(96, Math.min(180, r * 0.38));
  if (!narrow && fontAt(margin) < 8) margin = Math.max(84, Math.min(120, r * 0.22));
  return { cx: width / 2, cy: height / 2, r, rIn: Math.max(50, r - margin), margin, narrow };
}

/** The tree laid out in polar coordinates: x is the angle, y the radius. */
export function layoutTree(data: IDatum, mode: ILayoutMode, rIn: number): IPoint {
  const h = hierarchy(data);
  const isTree = mode === 'tree';
  const separation = (a: IPoint, b: IPoint) => {
    const base = a.parent === b.parent ? 1 : 2.4;
    const actor = a.data.node.kind === 'actor' || b.data.node.kind === 'actor' ? 2.4 : 1;
    return (base * actor) / (isTree ? Math.max(1, Math.min(a.depth, 3)) : 1);
  };
  return (isTree ? tree<IDatum>() : cluster<IDatum>()).size([TAU, rIn]).separation(separation)(h);
}

/** How labels fit: font size from the room per leaf, characters from the label band. */
export interface ILabelFit {
  fs: number;
  chars: number;
  actorChars: number;
  withName: boolean;
  hidden: boolean;
}

export function labelFit(g: IGeometry, leaves: number, wide: boolean): ILabelFit {
  const fs = Math.max(5, Math.min(10.5, ((TAU * g.rIn) / Math.max(1, leaves)) * 0.9));
  const chars = Math.floor((g.margin - 40) / (fs * 0.6));
  const actorChars = Math.max(wide ? 26 : 16, Math.floor((g.margin - 34) / ((fs + 1.5) * 0.64)));
  return { fs, chars, actorChars, withName: fs >= 8 && chars >= 16, hidden: g.narrow || fs < 5.2 };
}

const trunc = (s: string, n: number) => (n < 2 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A leaf's label as the cockpit writes it: actors by name, records with their key when room. */
export function labelOf(n: ITreeNode, fit: ILabelFit): string {
  if (n.kind === 'actor') return trunc(n.label, fit.actorChars);
  if (n.short)
    return fit.withName ? `${n.short} ${trunc(n.label, fit.chars - n.short.length - 1)}` : n.short;
  return trunc(n.label, fit.withName ? fit.chars : Math.max(10, Math.min(fit.chars, 18)));
}

export const nodeRadius = (n: ITreeNode) =>
  2.3 + Math.max(0, Math.min(4, Number(n.size) || 0)) * 0.55;
