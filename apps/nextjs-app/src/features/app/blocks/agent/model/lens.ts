import type { IBoard } from './search-board';

/** Cockpit design §5.3: what the board brightens. */
export type ILensMode = 'answer' | 'retrieved';

/**
 * Card keys the lens keeps bright, or undefined for all of them. The hover trace lights cards
 * over the lens but never replaces it, so the constellation and the readout hold still.
 */
export function lensKeys(board: IBoard | undefined, mode: ILensMode) {
  if (!board || mode === 'retrieved' || !board.lens.length) return undefined;
  // the answer cites records; every card of a cited record is bright
  const cited = new Set(
    board.cards.filter((c) => board.lens.includes(c.key)).map((c) => c.recordId)
  );
  return new Set(board.cards.filter((c) => cited.has(c.recordId)).map((c) => c.key));
}

/** The records of some card keys, for the constellation (which draws records, not cards). */
export const recordsOfKeys = (board: IBoard | undefined, keys: Set<string> | undefined) =>
  board && keys
    ? new Set(board.cards.filter((c) => keys.has(c.key)).map((c) => c.recordId))
    : undefined;

/** The lens the board starts in: the answer once it cites records, else everything found. */
export const defaultLens = (board: IBoard | undefined): ILensMode =>
  board?.lens.length && board.status !== 'running' ? 'answer' : 'retrieved';
