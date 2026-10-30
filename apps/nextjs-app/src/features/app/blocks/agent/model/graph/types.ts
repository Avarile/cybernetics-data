/* The constellation's graph contract, ported from the ai-cockpit's types.ts: every view of a
   search becomes this, and the chart reads nothing else (cockpit design §5.4). */
import type { ISearchTone } from '@teable/openapi';

export type ITone = ISearchTone;
export const TONES: readonly ITone[] = [
  'ink',
  'route',
  'target',
  'caution',
  'dim',
  'faint',
  'none',
];
export type INodeKind = 'item' | 'hub' | 'actor';

export interface IGNode {
  id: string;
  kind: INodeKind;
  label: string;
  /** A key like "TASK · #42", shown before the label. */
  short: string | null;
  parent: string | null;
  tone: ITone;
  /** Halo: overdue, deadline passed. */
  alert?: boolean;
  /** A "+N more" marker standing in for records not drawn. */
  overflow?: boolean;
  /** 0-4: priority or amount. */
  size?: number;
  date?: number;
  state?: string;
  table?: string;
  /** The board card this node draws (for the lens and the trace). */
  cardKey?: string;
  /** The record behind the node, to open it or ask about it (overview). */
  recordId?: string;
  tableId?: string;
  meta?: [string, string][];
}

export interface IGLink {
  id: string;
  source: string;
  target: string;
  tone: ITone;
  label: string;
}

export interface IBranch {
  id: string;
  label: string;
  count: number;
  mix: Record<ITone, number>;
  alert: number;
}

export interface IGraphInput {
  title: string;
  nodes: IGNode[];
  links: IGLink[];
}

export interface IGraph extends IGraphInput {
  byId: Map<string, IGNode>;
  kids: Map<string, IGNode[]>;
  branches: IBranch[];
}

/** The nodes a drawn link joins to `id` (e.g. a person to every task they are on). */
export const linkedTo = (g: IGraphInput, id: string): string[] =>
  g.links.flatMap((l) => (l.source === id ? [l.target] : l.target === id ? [l.source] : []));

/** Adds lookups and one summary per top-level branch (ported from the cockpit's finishGraph). */
export function finishGraph(input: IGraphInput): IGraph {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, IGNode[]>();
  for (const n of input.nodes) {
    const p = n.parent && n.parent !== n.id && byId.has(n.parent) ? n.parent : null;
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(n);
  }
  const roots = input.nodes.filter((n) => !n.parent || !byId.has(n.parent));
  const branches = roots.map((r) => {
    const mix = Object.fromEntries(TONES.map((t) => [t, 0])) as Record<ITone, number>;
    let count = 0;
    let alert = 0;
    const seen = new Set<string>();
    const stack = [r];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      for (const c of kids.get(n.id) ?? []) stack.push(c);
      if (n.kind !== 'item') continue;
      count++;
      mix[n.tone]++;
      if (n.alert) alert++;
    }
    return { id: r.id, label: r.label, count, mix, alert };
  });
  return { ...input, byId, kids, branches };
}
