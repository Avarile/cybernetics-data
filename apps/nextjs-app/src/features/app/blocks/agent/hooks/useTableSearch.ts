import { useQuery } from '@tanstack/react-query';
import type { ICockpitSearchResult } from '@teable/openapi';
import { useEffect } from 'react';
import { cockpitQueryKeys, searchTable } from '../data/cockpit-api';
import { currentDataset } from '../model/overview/cycle';
import { forcedOf } from '../model/search-results';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';

const noResults: ICockpitSearchResult[] = [];

/**
 * The active search (scope design §7): the table page's Search on the table on the stage, its
 * results and its state. The owner (one per cockpit) also forces the first results onto the
 * chart when they land, logs them, and runs the search again on another table.
 */
export function useTableSearch(owner = false) {
  const query = useSearchStore((s) => s.query);
  const result = useQuery({
    queryKey: query
      ? cockpitQueryKeys.search(query.tableId, query.text, query.nonce)
      : ['agent', 'cockpit', 'search', 'none'],
    queryFn: ({ signal }) => searchTable(query!.tableId, query!.text, signal),
    enabled: Boolean(query),
    staleTime: 30_000,
    retry: false,
  });
  const data =
    query && result.data?.tableId === query.tableId && result.data.q === query.text
      ? result.data
      : undefined;

  useEffect(() => {
    if (!owner || !data) return;
    const store = useSearchStore.getState();
    store.setForced(forcedOf(data.results));
    const table = store.tables.find((t) => t.id === data.tableId)?.name ?? '';
    store.addLog('query', `"${data.q}" · ${data.total} IN ${table.toUpperCase()}`);
  }, [owner, data]);

  // the search follows the table on the stage (`/table`, the menu, a key)
  const onStage = useCockpitStore((s) => currentDataset(s.cycle));
  useEffect(() => {
    if (!owner || !query || !onStage || onStage === query.tableId) return;
    useSearchStore.getState().search(query.text, onStage);
  }, [owner, query, onStage]);

  const error = result.error ? (result.error as Error).message || 'SEARCH FAILED' : undefined;
  useEffect(() => {
    if (owner && error) useSearchStore.getState().addLog('error', error);
  }, [owner, error]);

  return {
    query,
    data,
    results: data?.results ?? noResults,
    searching: Boolean(query) && result.isFetching,
    error,
  };
}
