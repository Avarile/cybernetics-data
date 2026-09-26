import { useQueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useTableListener } from '@teable/sdk/hooks';
import { useEffect, useMemo, useRef } from 'react';

/** Realtime is per table; beyond this, window-focus refetch has to do. */
export const MAX_LIVE_TABLES = 20;
const DEBOUNCE_MS = 2000;

const RECORD_ACTIONS = ['addRecord', 'setRecord', 'deleteRecord'] as const;

const useDebouncedInvalidate = (baseId: string) => {
  const queryClient = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return useMemo(
    () => () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseGraph(baseId) });
        queryClient.invalidateQueries({ queryKey: ['base-graph-node', baseId] });
      }, DEBOUNCE_MS);
    },
    [baseId, queryClient]
  );
};

/** One component per table, because useTableListener takes a single table. */
const TableListener = (props: { tableId: string; onChange: () => void }) => {
  useTableListener(props.tableId, [...RECORD_ACTIONS], props.onChange);
  return null;
};

/**
 * Invalidates the graph (debounced) when records change in any table it shows,
 * so edits made in the grid appear without a manual refresh.
 */
export const GraphLiveInvalidation = (props: { baseId: string; tableIds: string[] }) => {
  const invalidate = useDebouncedInvalidate(props.baseId);
  if (props.tableIds.length > MAX_LIVE_TABLES) {
    return null;
  }
  return (
    <>
      {props.tableIds.map((tableId) => (
        <TableListener key={tableId} tableId={tableId} onChange={invalidate} />
      ))}
    </>
  );
};
