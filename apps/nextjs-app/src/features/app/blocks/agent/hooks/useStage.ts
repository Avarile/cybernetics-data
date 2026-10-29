import type { IClarifyOption } from '@teable/openapi';
import { useMemo, useState } from 'react';
import { boardToGraph } from '../model/graph/from-board';
import { limitGraph } from '../model/graph/limit';
import { defaultLens, lensKeys } from '../model/lens';
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
  const lit = lensKeys(board, lensMode, trace);
  const metrics = useMemo(
    () => (board ? metricsOf(board, lensMode === 'answer' ? lit : undefined) : []),
    [board, lensMode, lit]
  );
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
  /** Card keys as record ids, for the constellation (which draws records). */
  const recordsOf = (keys?: Set<string>) =>
    keys && board
      ? new Set(board.cards.filter((c) => keys.has(c.key)).map((c) => c.recordId))
      : undefined;
  const keyOfRecord = (recordId?: string) => board?.cards.find((c) => c.recordId === recordId)?.key;
  const pin = (key?: string) => store.pin(store.pinned === key ? undefined : key);

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
    /** For the constellation: the answer's records, or the trace. */
    graphLens: lensMode === 'answer' && !trace ? recordsOf(lit) : undefined,
    graphLit: trace ? recordsOf(trace) : undefined,
    hoverRecord: (recordId?: string) => setHover(keyOfRecord(recordId)),
    pinRecord: (recordId: string) => pin(keyOfRecord(recordId)),
  };
}
