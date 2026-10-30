import type { IClarifyOption } from '@teable/openapi';
import { useCallback, useMemo, useState } from 'react';
import { boardToGraph } from '../model/graph/from-board';
import { limitGraph } from '../model/graph/limit';
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
  const { board, chat } = useSearchBoard();
  const store = useCockpitStore();
  const [hover, setHover] = useState<string>();
  const [layout, setLayout] = useState<'bundle' | 'tree'>('bundle');
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
  const graphLit = useMemo(() => recordsOfKeys(board, trace), [board, trace]);
  const clarify = openClarify(chat.messages);
  const picks = useMemo(() => {
    if (!clarify || board?.status !== 'needs_choice') return undefined;
    return new Map<string, IClarifyOption>(
      clarify.options.filter((o) => o.recordRef).map((o) => [o.recordRef!.recordId, o])
    );
  }, [clarify, board?.status]);
  const limited = useMemo(
    () => (store.view === 'constellation' && board ? limitGraph(boardToGraph(board)) : undefined),
    [store.view, board]
  );
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
    board,
    clarify,
    picks,
    lensMode,
    trace,
    lit,
    metrics,
    limited,
    layout,
    setLayout,
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
