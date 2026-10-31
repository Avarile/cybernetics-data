import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { agentQueryKeys, fetchBases, fetchTables, saveDefaultBase } from '../data/agent-api';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';

const minute = 60_000;

/**
 * The cockpit's scope (scope design §5): the bases it can show, the current one (the admin's
 * choice while it exists, else the default, else the first), its tables, and the default base.
 */
export function useScope() {
  const queryClient = useQueryClient();
  const chosen = useSearchStore((s) => s.baseId);
  const setTables = useSearchStore((s) => s.setTables);
  const basesQuery = useQuery({
    queryKey: agentQueryKeys.bases,
    queryFn: fetchBases,
    staleTime: minute,
  });
  const bases = basesQuery.data?.bases ?? [];
  const defaultBaseId = basesQuery.data?.defaultBaseId ?? null;
  const has = (id?: string | null) => Boolean(id && bases.some((b) => b.id === id));
  let baseId: string | undefined = bases[0]?.id;
  if (has(chosen)) baseId = chosen;
  else if (has(defaultBaseId)) baseId = defaultBaseId!;

  const tablesQuery = useQuery({
    queryKey: agentQueryKeys.tables(baseId ?? ''),
    queryFn: () => fetchTables(baseId!),
    enabled: Boolean(baseId),
    staleTime: minute,
  });
  const tables = tablesQuery.data?.baseId === baseId ? tablesQuery.data?.tables : undefined;
  useEffect(() => {
    if (tables) setTables(tables);
  }, [tables, setTables]);

  const defaults = useMutation({
    mutationFn: saveDefaultBase,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: agentQueryKeys.bases }),
  });

  return {
    bases,
    baseId,
    base: bases.find((b) => b.id === baseId),
    defaultBaseId,
    tables: tables ?? [],
    /** The tables of the current base have arrived (the rotation can start). */
    tablesLoaded: Boolean(tables),
    error: basesQuery.error ?? tablesQuery.error ?? undefined,
    setDefault: (id: string) => defaults.mutateAsync(id),
    settingDefault: defaults.isPending,
  };
}

/** Another base: the table, the search and the pins start over (scope design §6.5). */
export const chooseBase = (baseId: string) => {
  useSearchStore.getState().setBase(baseId);
  const cockpit = useCockpitStore.getState();
  cockpit.pinOverview(undefined);
  cockpit.cycleEvent({ type: 'resume' });
};

/**
 * A table of the current base held on the stage (TABLE menu, a key, `/table`); the rotation learns
 * the base's tables first if it has not yet.
 */
export const holdTable = (tableId: string) => {
  const { tables } = useSearchStore.getState();
  const cockpit = useCockpitStore.getState();
  if (!tables.some((t) => t.id === tableId) || cockpit.overviewFailed[tableId]) return false;
  if (!cockpit.cycle.order.includes(tableId))
    cockpit.cycleEvent({
      type: 'available',
      order: tables.map((t) => t.id).filter((id) => !cockpit.overviewFailed[id]),
    });
  cockpit.cycleEvent({ type: 'pick', id: tableId });
  return true;
};
