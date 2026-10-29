import type { IBoard } from './search-board';

/** Cockpit design §5.3: what the board brightens. */
export type ILensMode = 'answer' | 'retrieved';

/** Card keys to keep bright, or undefined for all of them. */
export function lensKeys(board: IBoard | undefined, mode: ILensMode, trace?: Set<string>) {
  if (trace?.size) return trace;
  if (!board || mode === 'retrieved' || !board.lens.length) return undefined;
  // the answer cites records; every card of a cited record is bright
  const cited = new Set(
    board.cards.filter((c) => board.lens.includes(c.key)).map((c) => c.recordId)
  );
  return new Set(board.cards.filter((c) => cited.has(c.recordId)).map((c) => c.key));
}

/** The lens the board starts in: the answer once it cites records, else everything found. */
export const defaultLens = (board: IBoard | undefined): ILensMode =>
  board?.lens.length && board.status !== 'running' ? 'answer' : 'retrieved';
