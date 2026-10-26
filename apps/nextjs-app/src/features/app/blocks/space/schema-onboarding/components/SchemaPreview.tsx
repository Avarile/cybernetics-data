import type { ISchemaPackCatalogVo, SchemaPackId } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useMemo } from 'react';
import { PACK_THEME } from '../packTheme';

/** Hand-laid positions: one quadrant per pack, so the map reads the same for everyone. */
const POSITIONS: Record<string, [number, number]> = {
  goals: [40, 38],
  projects: [92, 72],
  tasks: [48, 118],
  project_frameworks: [138, 30],
  contacts: [252, 84],
  companies: [300, 40],
  contact_type: [206, 40],
  contact_profession: [304, 124],
  auditlog: [214, 128],
  knowledges: [64, 214],
  knowledge_type: [128, 178],
  finance_Transactions: [254, 214],
  finance_Accounts: [204, 178],
  finance_Categories: [306, 178],
  finance_Payees: [308, 250],
  finance_Budgets: [200, 250],
  finance_Tags: [254, 266],
};

/** Names that would run into their neighbours at a readable size. */
const SHORT: Record<string, string> = {
  project_frameworks: 'frameworks',
  contact_type: 'contact types',
  contact_profession: 'professions',
  knowledge_type: 'note types',
};

const label = (key: string, name: string) =>
  SHORT[key] ?? name.replace(/^finance_/, '').replace(/_/g, ' ');

export interface ISchemaPreviewProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  optionalTables: string[];
  /** Nodes pulse while the base is being built. */
  building?: boolean;
  className?: string;
}

/**
 * Build animation: tables pop in one by one and then breathe while the server works, and links
 * draw themselves in after them. Plain CSS because it needs per-element lengths and delays.
 */
const BUILD_CSS = `
@keyframes sp-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
@keyframes sp-breathe { 50% { opacity: 0.55; } }
@keyframes sp-draw { from { stroke-dashoffset: var(--sp-len); } to { stroke-dashoffset: 0; } }
.sp-pop {
  transform-box: fill-box;
  transform-origin: center;
  animation: sp-pop 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both, sp-breathe 2s ease-in-out infinite;
  animation-delay: var(--sp-delay), calc(var(--sp-delay) + 1.6s);
}
.sp-draw {
  stroke-dasharray: var(--sp-len);
  animation: sp-draw 600ms ease-out both;
  animation-delay: var(--sp-delay);
}
@media (prefers-reduced-motion: reduce) { .sp-pop, .sp-draw { animation: none; } }
`;
const NODE_STAGGER_MS = 70;
const EDGE_STAGGER_MS = 45;

const animationVars = (delay: number, length?: number) =>
  ({
    '--sp-delay': `${Math.round(delay)}ms`,
    ...(length === undefined ? {} : { '--sp-len': String(length) }),
  }) as React.CSSProperties;

type NodeState = 'on' | 'ghost' | 'off';
type LineState = 'solid' | 'pending' | 'hidden';

const lineState = (a: NodeState, b: NodeState): LineState =>
  a === 'on' && b === 'on' ? 'solid' : a === 'on' || b === 'on' ? 'pending' : 'hidden';

const EDGE_OPACITY: Record<LineState, string> = {
  solid: 'opacity-90',
  pending: 'opacity-40',
  hidden: 'opacity-0',
};

const NODE_OPACITY: Record<NodeState, string> = {
  on: 'opacity-100',
  ghost: 'opacity-50',
  off: 'opacity-25',
};

const nodeFill = (state: NodeState, pack: SchemaPackId) =>
  state === 'on' ? PACK_THEME[pack].node : 'fill-background stroke-muted-foreground';

export const SchemaPreview = (props: ISchemaPreviewProps) => {
  const { catalog, packs, optionalTables, building, className } = props;

  const { nodes, edges } = useMemo(() => {
    const nodes = catalog.packs.flatMap((pack) =>
      pack.tables.map((table) => {
        const picked = packs.includes(pack.id);
        const state: NodeState = !picked
          ? 'off'
          : table.optional && !optionalTables.includes(table.key)
            ? 'ghost'
            : 'on';
        return { key: table.key, name: table.name, pack: pack.id, optional: table.optional, state };
      })
    );
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const seen = new Set<string>();
    const edges: { from: string; to: string; bridge: boolean; pack: SchemaPackId }[] = [];
    const addEdge = (from: string, to: string | undefined, bridge: boolean) => {
      if (!to || from === to || !byKey.has(from) || !byKey.has(to)) return;
      const id = [from, to].sort().join('~');
      if (seen.has(id)) return;
      seen.add(id);
      edges.push({ from, to, bridge, pack: byKey.get(from)!.pack });
    };
    catalog.packs.forEach((p) =>
      p.tables.forEach((t) => t.fields.forEach((f) => addEdge(t.key, f.linkTo, false)))
    );
    catalog.bridges.forEach((b) => b.fields.forEach((f) => addEdge(f.table, f.field.linkTo, true)));
    return { nodes, edges };
  }, [catalog, packs, optionalTables]);

  const stateOf = (key: string) => nodes.find((n) => n.key === key)?.state ?? 'off';
  const onKeys = nodes.filter((n) => n.state === 'on').map((n) => n.key);
  const onCount = onKeys.length;
  let drawn = 0;

  return (
    <svg
      viewBox="0 0 340 290"
      role="img"
      aria-label={`${onCount} tables`}
      className={cn('h-auto w-full select-none', className)}
    >
      {building && <style>{BUILD_CSS}</style>}
      {edges.map((edge) => {
        const a = POSITIONS[edge.from];
        const b = POSITIONS[edge.to];
        if (!a || !b) return null;
        const line = lineState(stateOf(edge.from), stateOf(edge.to));
        const draw = building && line === 'solid';
        const delay = onCount * NODE_STAGGER_MS + drawn * EDGE_STAGGER_MS;
        if (draw) drawn += 1;
        return (
          <line
            key={`${edge.from}~${edge.to}`}
            data-testid={edge.bridge ? `bridge-${edge.from}-${edge.to}` : undefined}
            data-state={line}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            strokeWidth={edge.bridge ? 1.6 : 1.2}
            strokeDasharray={line === 'solid' ? undefined : '3 3'}
            style={draw ? animationVars(delay, Math.hypot(b[0] - a[0], b[1] - a[1])) : undefined}
            className={cn(
              'transition-opacity duration-300 motion-reduce:transition-none',
              draw && 'sp-draw',
              edge.bridge ? 'stroke-foreground/50' : PACK_THEME[edge.pack].edge,
              EDGE_OPACITY[line]
            )}
          />
        );
      })}
      {nodes.map((node) => {
        const pos = POSITIONS[node.key];
        if (!pos) return null;
        const order = building ? onKeys.indexOf(node.key) : -1;
        return (
          <g
            key={node.key}
            data-testid={`node-${node.key}`}
            data-state={node.state}
            style={order >= 0 ? animationVars(order * NODE_STAGGER_MS) : undefined}
            className={cn(
              'transition-opacity duration-300 motion-reduce:transition-none',
              NODE_OPACITY[node.state],
              order >= 0 && 'sp-pop'
            )}
          >
            <circle
              cx={pos[0]}
              cy={pos[1]}
              r={node.optional ? 5.5 : 7.5}
              strokeWidth={1.5}
              strokeDasharray={node.state === 'on' ? undefined : '2 2'}
              className={nodeFill(node.state, node.pack)}
            />
            {/* Unpicked tables stay unlabelled: dots, not a word cloud. */}
            {node.state !== 'off' && (
              <text
                x={pos[0]}
                y={pos[1] + 19}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {label(node.key, node.name)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
