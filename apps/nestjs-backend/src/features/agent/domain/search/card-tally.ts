import type { ISearchCard, ISearchTone, IStepTally } from './search.types';

/** Open work first: in progress, on hold, next, backlog; then settled, then cancelled. */
const rank: Record<ISearchTone, number> = {
  route: 0,
  caution: 1,
  target: 2,
  dim: 3,
  none: 4,
  ink: 5,
  faint: 6,
};

/**
 * A related step's cards in the order the cockpit shows them (cockpit design §6.6): overdue work,
 * then open work, then what is settled. Stable, so records of one state keep their link order.
 * A step shows only its first cards, so this decides which records a big project shows.
 */
export const openFirst = (cards: ISearchCard[]): ISearchCard[] =>
  cards
    .slice()
    .sort(
      (a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)) || rank[a.tone] - rank[b.tone]
    );

/**
 * How many of a step's records are in each state, over every record it read: the readout and the
 * model count from this, not from the cards, which are only the first few. Undefined when the
 * table has no status-like field.
 */
export function tallyOf(cards: ISearchCard[]): IStepTally | undefined {
  if (!cards.some((c) => c.state)) return undefined;
  const rows = new Map<string, IStepTally['states'][number]>();
  for (const c of cards) {
    const state = c.state ?? '';
    const key = `${c.tone}|${state}`;
    const row = rows.get(key) ?? { state, tone: c.tone, count: 0 };
    row.count++;
    rows.set(key, row);
  }
  return {
    counted: cards.length,
    overdue: cards.filter((c) => c.alert).length,
    states: [...rows.values()].sort((a, b) => rank[a.tone] - rank[b.tone] || b.count - a.count),
  };
}
