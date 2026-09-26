import { Search, X } from '@teable/icons';
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import type { ISimulationNode } from '../utils/buildSimulationGraph';
import { colorForNode } from '../utils/graphTheme';

export type ISearchNode = Pick<
  ISimulationNode,
  'id' | 'label' | 'tier' | 'colorKey' | 'depth' | 'kind' | 'tableId'
>;

const MAX_RESULTS = 50;

interface INodeSearchProps {
  /** Every drawable node. */
  nodes: ISearchNode[];
  tableNames: ReadonlyMap<string, string>;
  onSelect: (nodeId: string) => void;
  onClear: () => void;
}

export const NodeSearch = (props: INodeSearchProps) => {
  const { nodes, tableNames, onSelect, onClear } = props;
  const { t } = useTranslation(['baseGraph']);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return nodes.slice(0, MAX_RESULTS);
    }
    const matches: ISearchNode[] = [];
    for (const node of nodes) {
      if (node.label.toLowerCase().includes(needle)) {
        matches.push(node);
        if (matches.length === MAX_RESULTS) {
          break;
        }
      }
    }
    return matches;
  }, [nodes, query]);

  const hasQuery = query.trim().length > 0;

  const handleClear = () => {
    setQuery('');
    onClear();
  };

  return (
    <div className="pointer-events-auto w-72 rounded-md border bg-background/90 shadow-sm backdrop-blur">
      {/*
        shouldFilter={false}: we already hold the full node list, and cmdk's
        built-in fuzzy filter over ~2000 items is a per-keystroke cost.
      */}
      <Command shouldFilter={false} className="bg-transparent">
        <div className="flex items-center gap-1 px-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t('baseGraph:search.placeholder')}
            className="h-9 border-0"
          />
          {query && (
            <Button variant="ghost" size="icon-xs" onClick={handleClear}>
              <X className="size-3.5" />
            </Button>
          )}
        </div>

        {/*
          Mounted unconditionally, with its contents gated instead. cmdk 1.0.0
          schedules selectFirstItem() into a layout effect on every `search`
          change, and the getValidItems() it calls there is
          `Array.from(listInnerRef.current?.querySelectorAll(...))` with no
          fallback — so taking the list out of the tree nulls that ref before
          the effect runs and emptying the box threw "undefined is not
          iterable". An empty list has no children and so no height; `hidden`
          keeps the bare listbox out of the accessibility tree while leaving the
          element, and cmdk's ref to it, in place.
        */}
        <CommandList className={cn('max-h-64', !hasQuery && 'hidden')}>
          {hasQuery && (
            <>
              <CommandEmpty className="px-3 py-4 text-xs text-muted-foreground">
                {t('baseGraph:search.noResults', { query })}
              </CommandEmpty>
              {results.map((node) => (
                <CommandItem
                  key={node.id}
                  value={node.id}
                  onSelect={() => onSelect(node.id)}
                  className="gap-2 text-xs"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorForNode(node) }}
                  />
                  <span className="truncate">{node.label}</span>
                  {node.tableId && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {tableNames.get(node.tableId)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </>
          )}
        </CommandList>
      </Command>
    </div>
  );
};
