import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ICockpitSearchResult } from '@teable/openapi';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { agentQueryKeys, fetchTableOverview } from '../data/agent-api';
import { cockpitQueryKeys, fetchNodes } from '../data/cockpit-api';
import { limitGraph, SAFE_DRAW } from '../model/graph/limit';
import { mergeNodes } from '../model/graph/merge';
import { traceGraph } from '../model/graph/trace';
import { currentDataset, nextDataset, remainingAt, running } from '../model/overview/cycle';
import { overviewToGraph } from '../model/overview/from-overview';
import { overviewMetrics } from '../model/overview/metrics';
import { DATASET_MS, PREFETCH_MS, pendingInfo, tableInfo } from '../model/overview/presentation';
import { markedOf, nodeOf } from '../model/search-results';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchStore } from '../state/search-store';
import { useScope } from './useScope';
import { useTableSearch } from './useTableSearch';

const noResults: ICockpitSearchResult[] = [];

/** Narrow screens draw less and without labels (overview design §9.6). */
const NARROW = '(max-width: 899px)';
const narrowBudget = 400;

export function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.(NARROW);
    if (!media) return;
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return narrow;
}

const reasonOf = (error: unknown) => {
  const status = (error as { status?: number })?.status;
  if (status === 403) return 'NO ACCESS';
  if (status === 404) return 'NOT FOUND';
  return (error as Error)?.message ?? 'FAILED';
};

const overviewQuery = (tableId: string) => ({
  queryKey: agentQueryKeys.tableOverview(tableId),
  queryFn: () => fetchTableOverview(tableId),
  staleTime: DATASET_MS,
  gcTime: 10 * DATASET_MS,
  retry: false,
});

/**
 * The overview on the stage (overview design §6, §9; scope design §5.3, §9): the table of the
 * current base the cycle is on, fetched (and the next one before it is due), its graph within
 * the draw budget, its numbers and words, the trace of the node pointed at or pinned, and which
 * tables can be shown at all.
 */
export function useOverview(active: boolean) {
  const queryClient = useQueryClient();
  const scope = useScope();
  const cycle = useCockpitStore((s) => s.cycle);
  const cycleEvent = useCockpitStore((s) => s.cycleEvent);
  const pinned = useCockpitStore((s) => s.overviewPinned);
  const [hover, setHover] = useState<string>();
  const failed = useCockpitStore((s) => s.overviewFailed);
  const failDataset = useCockpitStore((s) => s.failDataset);
  const narrow = useNarrow();
  const tableId = currentDataset(cycle) ?? scope.tables[0]?.id ?? '';
  const query = useQuery({ ...overviewQuery(tableId), enabled: active && Boolean(tableId) });
  const vo = query.data?.tableId === tableId ? query.data : undefined;

  // a table that cannot be shown (no access, gone, nothing to draw) leaves the loop
  useEffect(() => {
    let reason: string | undefined;
    if (query.error) reason = reasonOf(query.error);
    else if (vo && !vo.nodes.length)
      reason = vo.missing.length ? `NOT IN THIS BASE: ${vo.missing.join(', ')}` : 'NOTHING TO DRAW';
    if (reason && tableId) failDataset(tableId, reason);
  }, [query.error, vo, tableId, failDataset]);
  const available = useMemo(
    () => scope.tables.map((t) => t.id).filter((id) => !failed[id]),
    [scope.tables, failed]
  );

  // the table the admin chose last time comes back once its base's tables are here
  const restore = useRef(useSearchStore.getState().tableId);
  const order = available.join(',');
  useEffect(() => {
    if (!scope.tablesLoaded) return;
    const ids = order ? order.split(',') : [];
    cycleEvent({ type: 'available', order: ids });
    if (restore.current && ids.includes(restore.current))
      cycleEvent({ type: 'pick', id: restore.current });
    restore.current = undefined;
  }, [order, scope.tablesLoaded, cycleEvent]);

  // the minute starts when the table is on screen, not when it was asked for
  useEffect(() => {
    if (active && vo && !cycle.drawn) cycleEvent({ type: 'drawn' });
  }, [active, vo, cycle.drawn, cycleEvent]);

  // the next table is fetched before it is due, so the switch is immediate
  const next = nextDataset(cycle);
  useEffect(() => {
    if (!active || !next || !running(cycle)) return;
    const wait = Math.max(0, remainingAt(cycle, Date.now()) - PREFETCH_MS);
    const timer = setTimeout(() => void queryClient.prefetchQuery(overviewQuery(next)), wait);
    return () => clearTimeout(timer);
  }, [active, next, cycle, queryClient]);

  const name = scope.tables.find((t) => t.id === tableId)?.name ?? '';
  const info = useMemo(
    () => (vo ? tableInfo(vo) : pendingInfo(tableId, name)),
    [vo, tableId, name]
  );

  // the search's forced results are drawn for sure: read when the overview has not (§7.3)
  const search = useTableSearch();
  const forced = useSearchStore((s) => s.forced);
  const searchHere = search.query?.tableId === tableId;
  const missing = useMemo(
    () =>
      vo && searchHere
        ? forced.filter((id) => !vo.nodes.some((n) => n.recordId === id)).sort()
        : [],
    [vo, searchHere, forced]
  );
  const extra = useQuery({
    queryKey: cockpitQueryKeys.nodes(tableId, missing),
    queryFn: () => fetchNodes(tableId, missing),
    enabled: active && missing.length > 0,
    staleTime: DATASET_MS,
    retry: false,
  });
  const merged = useMemo(
    () => (vo && extra.data && missing.length ? mergeNodes(vo, extra.data.nodes) : vo),
    [vo, extra.data, missing.length]
  );
  const graph = useMemo(() => (merged ? overviewToGraph(merged) : undefined), [merged]);
  const must = useMemo(
    () =>
      graph && searchHere && forced.length ? new Set(forced.map((id) => nodeOf(graph, id))) : null,
    [graph, searchHere, forced]
  );
  const limited = useMemo(
    () =>
      graph ? limitGraph(graph, { budget: narrow ? narrowBudget : SAFE_DRAW, must }) : undefined,
    [graph, narrow, must]
  );
  const results = useMemo(
    () => (searchHere ? search.results : noResults),
    [searchHere, search.results]
  );
  const marked = useMemo(() => markedOf(results, limited?.graph), [results, limited]);
  const metrics = useMemo(() => (vo ? overviewMetrics(vo) : []), [vo]);
  const pin = useCallback((id?: string) => {
    const store = useCockpitStore.getState();
    store.pinOverview(store.overviewPinned === id ? undefined : id);
  }, []);
  const focused = hover ?? pinned;
  // the trace of what is pointed at or pinned; else the results stay lit
  const lit = useMemo(
    () => (limited && focused ? traceGraph(limited.graph, focused) : marked),
    [limited, focused, marked]
  );

  return {
    tableId,
    scope,
    vo,
    info,
    loading: query.isLoading,
    error: query.error ? reasonOf(query.error) : undefined,
    failed,
    available,
    graph,
    limited,
    metrics,
    lit,
    marked,
    search,
    results,
    narrow,
    pinned: pinned ? graph?.byId.get(pinned) : undefined,
    setHover,
    pin,
  };
}

/**
 * The overview's clock (overview design §6.4): one timeout for the time left, the hidden-tab and
 * pin holds, and a fresh minute whenever the overview comes back on screen.
 */
export function useOverviewCycle(active: boolean) {
  const cycle = useCockpitStore((s) => s.cycle);
  const cycleEvent = useCockpitStore((s) => s.cycleEvent);
  const pinned = useCockpitStore((s) => s.overviewPinned);

  useEffect(() => {
    if (active) cycleEvent({ type: 'restart' });
  }, [active, cycleEvent]);

  useEffect(() => {
    if (!active || !running(cycle)) return;
    const timer = setTimeout(() => cycleEvent({ type: 'tick' }), remainingAt(cycle, Date.now()));
    return () => clearTimeout(timer);
  }, [active, cycle, cycleEvent]);

  useEffect(() => {
    const sync = () => cycleEvent({ type: document.hidden ? 'hold' : 'release', reason: 'hidden' });
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [cycleEvent]);

  useEffect(() => {
    cycleEvent({ type: pinned ? 'hold' : 'release', reason: 'pin' });
  }, [pinned, cycleEvent]);
}
