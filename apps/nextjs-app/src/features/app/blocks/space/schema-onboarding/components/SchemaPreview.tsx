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

const label = (name: string) => name.replace(/^finance_/, '').replace(/_/g, ' ');

export interface ISchemaPreviewProps {
  catalog: ISchemaPackCatalogVo;
  packs: SchemaPackId[];
  optionalTables: string[];
  /** Nodes pulse while the base is being built. */
  building?: boolean;
  className?: string;
}

type NodeState = 'on' | 'ghost' | 'off';

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
    return { nodes, edges, byKey };
  }, [catalog, packs, optionalTables]);

  const stateOf = (key: string) => nodes.find((n) => n.key === key)?.state ?? 'off';
  const onCount = nodes.filter((n) => n.state === 'on').length;

  return (
    <svg
      viewBox="0 0 340 290"
      role="img"
      aria-label={`${onCount} tables`}
      className={cn('h-auto w-full select-none', className)}
    >
      {edges.map((edge) => {
        const a = POSITIONS[edge.from];
        const b = POSITIONS[edge.to];
        if (!a || !b) return null;
        const sa = stateOf(edge.from);
        const sb = stateOf(edge.to);
        const solid = sa === 'on' && sb === 'on';
        const half = !solid && (sa === 'on' || sb === 'on');
        return (
          <line
            key={`${edge.from}~${edge.to}`}
            data-testid={edge.bridge ? `bridge-${edge.from}-${edge.to}` : undefined}
            data-state={solid ? 'solid' : half ? 'pending' : 'hidden'}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            strokeWidth={edge.bridge ? 1.6 : 1.2}
            strokeDasharray={solid ? undefined : '3 3'}
            className={cn(
              'transition-opacity duration-300 motion-reduce:transition-none',
              edge.bridge ? 'stroke-foreground/50' : PACK_THEME[edge.pack].edge,
              solid ? 'opacity-90' : half ? 'opacity-30' : 'opacity-0'
            )}
          />
        );
      })}
      {nodes.map((node) => {
        const pos = POSITIONS[node.key];
        if (!pos) return null;
        return (
          <g
            key={node.key}
            data-testid={`node-${node.key}`}
            data-state={node.state}
            className={cn(
              'transition-opacity duration-300 motion-reduce:transition-none',
              node.state === 'on'
                ? 'opacity-100'
                : node.state === 'ghost'
                  ? 'opacity-40'
                  : 'opacity-20',
              building && node.state === 'on' && 'animate-pulse motion-reduce:animate-none'
            )}
          >
            <circle
              cx={pos[0]}
              cy={pos[1]}
              r={node.optional ? 5.5 : 7.5}
              strokeWidth={1.5}
              strokeDasharray={node.state === 'on' ? undefined : '2 2'}
              className={cn(
                node.state === 'on'
                  ? PACK_THEME[node.pack].node
                  : 'fill-background stroke-muted-foreground'
              )}
            />
            <text
              x={pos[0]}
              y={pos[1] + 18}
              textAnchor="middle"
              className="fill-muted-foreground text-[8px]"
            >
              {label(node.name)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};
