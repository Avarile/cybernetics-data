import { tableNodeId } from '@teable/openapi';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import type { ISimulationNode } from '../utils/buildSimulationGraph';
import { colorForNode } from '../utils/graphTheme';

interface IGraphLegendProps {
  tables: { id: string; name: string }[];
  /** Nodes with tier 'type': table hubs, groups, and group-target records. */
  typeNodes: Pick<
    ISimulationNode,
    'id' | 'kind' | 'tableId' | 'label' | 'depth' | 'tier' | 'colorKey'
  >[];
  /** The expanded closure, so a hidden parent's children read as hidden too. */
  hiddenIds: ReadonlySet<string>;
  hiddenTableIds: readonly string[];
  onToggleNode: (id: string) => void;
  onToggleTable: (tableId: string) => void;
  onShowAll: () => void;
}

/**
 * Tables, and within each the nodes other records hang from, indented by depth.
 * Table hubs are represented by the table row itself.
 */
export const GraphLegend = (props: IGraphLegendProps) => {
  const { tables, typeNodes, hiddenIds, hiddenTableIds, onToggleNode, onToggleTable, onShowAll } =
    props;
  const { t } = useTranslation(['baseGraph']);

  const rowsByTable = useMemo(() => {
    const map = new Map<string, typeof typeNodes>();
    for (const node of typeNodes) {
      if (node.kind === 'table' || !node.tableId) continue;
      map.set(node.tableId, [...(map.get(node.tableId) ?? []), node]);
    }
    return map;
  }, [typeNodes]);

  const hiddenCount =
    hiddenTableIds.length +
    typeNodes.filter((n) => n.kind !== 'table' && hiddenIds.has(n.id)).length;
  const allHidden = tables.length > 0 && tables.every((tb) => hiddenTableIds.includes(tb.id));

  return (
    <div className="pointer-events-auto flex max-h-[60vh] w-72 flex-col rounded-md border bg-background/90 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-semibold">{t('baseGraph:legend.title')}</span>
        {hiddenCount > 0 && (
          <Button variant="ghost" size="xs" className="h-5 text-[11px]" onClick={onShowAll}>
            {t('baseGraph:legend.showAll')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tables.map((table) => {
          const tableHidden = hiddenTableIds.includes(table.id);
          return (
            <div key={table.id}>
              <button
                type="button"
                onClick={() => onToggleTable(table.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-0.5 text-left font-medium hover:bg-accent',
                  tableHidden && 'opacity-40'
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: colorForNode({
                      tier: 'type',
                      colorKey: tableNodeId(table.id),
                      depth: 0,
                    }),
                  }}
                />
                <span className="truncate">{table.name}</span>
                {tableHidden ? (
                  <EyeOff className="ml-auto size-3 shrink-0" />
                ) : (
                  <Eye className="ml-auto size-3 shrink-0 opacity-0" />
                )}
              </button>
              {(rowsByTable.get(table.id) ?? []).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onToggleNode(node.id)}
                  className={cn(
                    'flex w-full items-center gap-2 py-0.5 pr-3 text-left hover:bg-accent',
                    (tableHidden || hiddenIds.has(node.id)) && 'opacity-40'
                  )}
                  style={{ paddingLeft: `${1.25 + Math.min(node.depth, 6) * 0.75}rem` }}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorForNode(node) }}
                  />
                  <span className="truncate">{node.label || '—'}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <div className="border-t px-3 py-1 text-[11px] text-muted-foreground">
          {allHidden
            ? t('baseGraph:legend.allHidden')
            : t('baseGraph:legend.hidden', { count: hiddenCount })}
        </div>
      )}
    </div>
  );
};
