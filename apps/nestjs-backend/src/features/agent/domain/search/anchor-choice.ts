/** An anchor hit: a record found by title or full text, best first. */
export interface IAnchorHit {
  recordId: string;
  title: string;
  /** Full-text rank, when the full-text index found it. */
  rank?: number;
  /** The title equals the searched text (case and spacing ignored). */
  exact: boolean;
}

export type IAnchorChoice =
  | { kind: 'chosen'; recordIds: string[] }
  | { kind: 'needs_choice'; candidates: IAnchorHit[] }
  | { kind: 'empty' };

export const MAX_CANDIDATES = 6;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const isExactTitle = (title: string, text: string) => squash(title) === squash(text);

/**
 * Which anchor records the search goes on with (cockpit design §6.6). A question about one record
 * (`single`) goes on only with a clear winner: one exact title, one hit, or a rank at least twice
 * the next; otherwise the admin chooses. A list question keeps every hit.
 */
export function chooseAnchor(hits: IAnchorHit[], single: boolean): IAnchorChoice {
  if (!hits.length) return { kind: 'empty' };
  if (!single) return { kind: 'chosen', recordIds: hits.map((h) => h.recordId) };
  const exact = hits.filter((h) => h.exact);
  if (exact.length === 1) return { kind: 'chosen', recordIds: [exact[0].recordId] };
  if (exact.length > 1) return { kind: 'needs_choice', candidates: exact.slice(0, MAX_CANDIDATES) };
  if (hits.length === 1) return { kind: 'chosen', recordIds: [hits[0].recordId] };
  const [top, next] = hits;
  if (top.rank && next.rank !== undefined && top.rank >= 2 * next.rank) {
    return { kind: 'chosen', recordIds: [top.recordId] };
  }
  return { kind: 'needs_choice', candidates: hits.slice(0, MAX_CANDIDATES) };
}
