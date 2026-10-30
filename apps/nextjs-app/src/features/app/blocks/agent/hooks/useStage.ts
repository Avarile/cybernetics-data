import { AGENT_DATA_PART, type IClarifyOption } from '@teable/openapi';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { boardEventOf } from '../data/stream-events';
import { boardToGraph } from '../model/graph/from-board';
import { limitGraph } from '../model/graph/limit';
import { linkedTo } from '../model/graph/types';
import { defaultLens, lensKeys, recordsOfKeys } from '../model/lens';
import { metricsOf } from '../model/metrics';
import { traceOf } from '../model/search-board';
import { openClarify } from '../model/transcript';
import { useCockpitStore } from '../state/cockpit-store';
import { useSearchBoard } from './useSearchBoard';

/**
 * What the stage shows (cockpit design §5.3–§5.6): the board, its lens and hover trace, the
 * readout numbers, the PICK options of an open question, and the constellation's graph.
 */
export function useStage() {
  const { board, chat, searches } = useSearchBoard();
  const store = useCockpitStore();
  // the overview unless a search was asked for and is there to show (overview design §4.1)
  const mode = store.stage === 'search' && board?.plan ? 'search' : 'overview';
  const [hover, setHover] = useState<string>();
  const lensMode = store.lens ?? defaultLens(board);
  const focused = hover ?? store.pinned;
  const trace = useMemo(
    () => (board && focused ? traceOf(board, focused) : undefined),
    [board, focused]
  );
  // the lens stays put while the pointer moves: the trace only lights cards over it, so the
  // readout keeps its numbers and the constellation its shape (§5.3)
  const lens = useMemo(() => lensKeys(board, lensMode), [board, lensMode]);
  const lit = trace?.size ? trace : lens;
  const metrics = useMemo(() => (board ? metricsOf(board, lens) : []), [board, lens]);
  const graphLens = useMemo(() => recordsOfKeys(board, lens), [board, lens]);
  const clarify = openClarify(chat.messages);
  const picks = useMemo(() => {
    if (!clarify || board?.status !== 'needs_choice') return undefined;
    return new Map<string, IClarifyOption>(
      clarify.options.filter((o) => o.recordRef).map((o) => [o.recordRef!.recordId, o])
    );
  }, [clarify, board?.status]);
  const limited = useMemo(
    () =>
      mode === 'search' && store.view === 'constellation' && board
        ? limitGraph(boardToGraph(board), { lens: graphLens })
        : undefined,
    [mode, store.view, board, graphLens]
  );
  // on the chart the trace also follows the links it draws: a person lights every task they
  // are on, not only the one they were reached from
  const graphLit = useMemo(() => {
    const records = recordsOfKeys(board, trace);
    const record = focused ? board?.cards.find((c) => c.key === focused)?.recordId : undefined;
    if (records && record && limited)
      linkedTo(limited.graph, record).forEach((id) => records.add(id));
    return records;
  }, [board, trace, focused, limited]);

  // live parts move the stage: a search that starts takes it from the overview (overview design
  // §4.1), and the answer may ask for a view (highlight_records). Replays and remounts never do.
  const session = chat.session;
  useEffect(() => {
    const started = new Set<string>();
    return session?.onData((part) => {
      if (part.type !== AGENT_DATA_PART.searchLens && part.type !== AGENT_DATA_PART.searchPlan)
        return;
      const event = boardEventOf(part);
      const store = useCockpitStore.getState();
      if (event?.type === 'plan' && !started.has(event.searchId)) {
        started.add(event.searchId);
        store.setStage('search');
      }
      if (event?.type === 'lens' && event.view) store.setView(event.view);
    });
  }, [session]);

  // stable callbacks, so the memoized cards, lanes and constellation skip renders they don't need
  const pin = useCallback((key?: string) => {
    const { pinned, pin: setPinned } = useCockpitStore.getState();
    setPinned(pinned === key ? undefined : key);
  }, []);
  const keyOfRecord = useCallback(
    (recordId?: string) => board?.cards.find((c) => c.recordId === recordId)?.key,
    [board]
  );
  const hoverRecord = useCallback(
    (recordId?: string) => setHover(keyOfRecord(recordId)),
    [keyOfRecord]
  );
  const pinRecord = useCallback(
    (recordId: string) => pin(keyOfRecord(recordId)),
    [pin, keyOfRecord]
  );

  return {
    mode,
    /** The conversation has a search the stage can show. */
    hasSearch: Boolean(board?.plan) || searches.length > 0,
    setStage: store.setStage,
    board,
    clarify,
    picks,
    lensMode,
    trace,
    lit,
    metrics,
    limited,
    layout: store.layout,
    setLayout: store.setLayout,
    zoomResets: store.zoomResets,
    view: store.view,
    setView: store.setView,
    setLens: store.setLens,
    close: store.close,
    setHover,
    pin,
    /** For the constellation: the answer's records (its shape), and the trace's (lit). */
    graphLens,
    graphLit,
    hoverRecord,
    pinRecord,
  };
}
