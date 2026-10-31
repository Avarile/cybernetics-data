/* The constellation's marks, ported from the ai-cockpit's tree.ts: the glyph and classes of a
   node, the arcs and labels of the branch rims, and the angle helpers the chart draws with. */
import type { Selection } from 'd3-selection';
import { symbol, symbolDiamond } from 'd3-shape';
import {
  TAU,
  nodeRadius,
  type IDatum,
  type IGeometry,
  type IPoint,
  type ITreeNode,
} from '../../model/graph/layout';
import type { IGraph } from '../../model/graph/types';

/** One top-level branch's arc on the rim, with its name and count when they fit. */
export interface IRim {
  id: string;
  /** The id of the path its label runs along. */
  sid: string;
  a0: number;
  a1: number;
  /** On the lower half: the label runs the other way, so it reads upright. */
  bottom: boolean;
  label: string;
}

/** Where each node is (angle, radius), by id. */
export type IPos = Map<string, { x: number; y: number }>;

/**
 * Where each node glides from and to: from where it was, else from its nearest ancestor that
 * was drawn, else up out of the core.
 */
export function glideEnds(h: IPoint, pos: IPos) {
  const to: IPos = new Map();
  const from: IPos = new Map();
  h.each((d) => {
    to.set(d.data.id, { x: d.x, y: d.y });
    const prev = pos.get(d.data.id);
    let anc = d.parent;
    while (!prev && anc && !pos.has(anc.data.id)) anc = anc.parent;
    from.set(d.data.id, prev ?? (anc && pos.get(anc.data.id)) ?? { x: d.x, y: 0 });
  });
  return { from, to };
}

export const norm = (a: number) => ((a % TAU) + TAU) % TAU;
export const lerpAngle = (a: number, b: number, t: number) => {
  let d = norm(b - a);
  if (d > Math.PI) d -= TAU;
  return a + d * t;
};
export const leavesOf = (d: IDatum): number =>
  d.children ? d.children.reduce((n, c) => n + leavesOf(c), 0) : 1;
export const keyOf = (n: ITreeNode) => (n.kind === 'root' ? 'root' : n.id);
const rimName = (n: ITreeNode) =>
  (n.kind !== 'root' && n.recordId ? n.label : n.short || n.label).toUpperCase();

export function arcPath(r: number, a0: number, a1: number, reverse: boolean): string {
  const p = (a: number) => [r * Math.sin(a), -r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [s, e] = reverse ? [p(a1), p(a0)] : [p(a0), p(a1)];
  return `M${s[0].toFixed(2)},${s[1].toFixed(2)}A${r},${r} 0 ${large} ${reverse ? 0 : 1} ${e[0].toFixed(2)},${e[1].toFixed(2)}`;
}

/** A node's marks: the core, a diamond for an actor, a ring for a hub, a dot (and halo) else. */
export function glyph(sel: Selection<SVGGElement, IPoint, null, undefined>, d: IPoint) {
  sel.selectAll('*').remove();
  const n = d.data.node;
  if (n.kind === 'root') {
    sel.append('circle').attr('class', 'core').attr('r', 5);
    return;
  }
  if (n.kind === 'actor') {
    const area = 70 + Math.min(80, (Number(n.size) || 0) * 20);
    sel
      .append('path')
      .attr('class', 'dia')
      .attr('d', symbol(symbolDiamond, area)() ?? '');
    return;
  }
  const r = n.kind === 'hub' ? 4 : nodeRadius(n) + (d.children ? 0.8 : 0);
  if (n.alert)
    sel
      .append('circle')
      .attr('class', 'halo')
      .attr('r', r + 3);
  sel
    .append('circle')
    .attr('class', n.kind === 'hub' ? 'hub' : 'dot')
    .attr('r', r);
}

export const nodeClass = (d: IPoint) => {
  const n = d.data.node;
  return [
    'v-node',
    n.kind,
    `t-${n.tone}`,
    n.alert && 'alert',
    d.children && 'parent',
    d.data.context && 'context',
    n.overflow && 'more',
  ]
    .filter(Boolean)
    .join(' ');
};

/** The rims of a laid-out tree, at angles `ang` (the turn included). */
export function rimsOf(
  h: IPoint,
  ang: (d: IPoint) => number,
  geo: IGeometry,
  graph: IGraph,
  uid: string
): IRim[] {
  const total = Math.max(1, h.leaves().length);
  return (h.children ?? []).map((c) => {
    const angles = c.leaves().map(ang);
    const pad = Math.min(0.025, (TAU / total) * 0.45);
    const a0 = Math.min(...angles) - pad;
    const a1 = Math.max(...angles) + pad;
    const mid = norm((a0 + a1) / 2);
    const node = c.data.node;
    const count = graph.branches.find((b) => b.id === node.id)?.count;
    const name = rimName(node);
    const full = count ? `${name} · ${count}` : name;
    const room = (a1 - a0) * (geo.r - 10);
    const label = full.length * 7 < room ? full : name.length * 7 < room ? name : '';
    const sid = `${uid}-rim-${node.id.replace(/[^a-z0-9-]/gi, '')}`;
    return { id: node.id, sid, a0, a1, bottom: mid > Math.PI / 2 && mid < Math.PI * 1.5, label };
  });
}
