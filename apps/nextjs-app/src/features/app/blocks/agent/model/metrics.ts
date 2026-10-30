import type { ISearchCard, ISearchTone, IStepTally } from '@teable/openapi';
import type { IBoard, ILane } from './search-board';

export interface IMetric {
  k: string;
  v: number | string;
  s?: string;
  tone: ISearchTone;
}

const count = (cards: ISearchCard[], tone: ISearchTone) =>
  cards.filter((c) => c.tone === tone).length;
const stepsOn = (board: IBoard, table: string) =>
  board.plan?.steps.filter((s) => s.table.name === table) ?? [];

type IWork = Record<ISearchTone, number> & { overdue: number; total: number };

/**
 * A table's records by tone. Without a lens: each step's tally, which counts every record the step
 * read, not only the cards it shows (a step still running has none yet, so its cards count).
 * Under a lens: the cited cards.
 */
function workOn(board: IBoard, cards: ISearchCard[], table: string, lens: boolean): IWork {
  const work: IWork = {
    ink: 0,
    route: 0,
    target: 0,
    caution: 0,
    dim: 0,
    faint: 0,
    none: 0,
    overdue: 0,
    total: 0,
  };
  for (const step of stepsOn(board, table)) {
    const tally =
      (!lens && board.states[step.id]?.tally) ||
      tallyOfCards(cards.filter((c) => c.stepId === step.id));
    for (const row of tally.states) work[row.tone] += row.count;
    work.overdue += tally.overdue;
    work.total += tally.counted;
  }
  return work;
}

/** Some cards, counted the way a step's tally counts its records. */
const tallyOfCards = (cards: ISearchCard[]): IStepTally => ({
  counted: cards.length,
  overdue: cards.filter((c) => c.alert).length,
  states: cards.map((c) => ({ state: c.state ?? '', tone: c.tone, count: 1 })),
});

/** A table's records: what its steps found, or the cited cards under a lens. */
const recordsOn = (board: IBoard, cards: ISearchCard[], table: string, lens: boolean) =>
  stepsOn(board, table).reduce((n, step) => {
    const shown = cards.filter((c) => c.stepId === step.id).length;
    return n + (lens ? shown : Math.max(board.states[step.id]?.found ?? 0, shown));
  }, 0);

/**
 * The readout's numbers (cockpit design §5.6). Progress questions count the work by state;
 * anything else counts records per table. Under a lens they count what the answer cites.
 */
export function metricsOf(board: IBoard, lens?: Set<string>): IMetric[] {
  const cards = lens ? board.cards.filter((c) => lens.has(c.key)) : board.cards;
  const plan = board.plan;
  if (!plan) return [];
  const narrowed = Boolean(lens);
  const work = plan.intent === 'goal_progress' || plan.intent === 'project_progress';
  if (work) {
    const tasks = workOn(board, cards, 'tasks', narrowed);
    const live = tasks.total - tasks.faint;
    return [
      {
        k: 'DONE',
        v: tasks.ink,
        s: live ? `${Math.round((tasks.ink / live) * 100)}%` : undefined,
        tone: 'ink',
      },
      { k: 'IN PROGRESS', v: tasks.route, tone: 'route' },
      { k: 'NEXT', v: tasks.target, tone: 'target' },
      { k: 'BACKLOG', v: tasks.dim, tone: 'dim' },
      // overdue work keeps its own state above; the late count rides along, never added twice
      {
        k: 'ON HOLD',
        v: tasks.caution,
        s: tasks.overdue ? `${tasks.overdue} LATE` : undefined,
        tone: 'caution',
      },
      { k: 'PEOPLE', v: recordsOn(board, cards, 'contacts', narrowed), tone: 'ink' },
      { k: 'KNOWLEDGE', v: recordsOn(board, cards, 'knowledges', narrowed), tone: 'ink' },
    ];
  }
  const tables = [...new Set(plan.steps.map((s) => s.table.name))];
  return tables
    .map((table) => ({
      k: table.toUpperCase(),
      v: recordsOn(board, cards, table, narrowed),
      tone: 'ink' as ISearchTone,
    }))
    .filter((m) => m.v > 0)
    .slice(0, 7);
}

const mixOrder: ISearchTone[] = ['ink', 'route', 'target', 'caution', 'dim', 'faint', 'none'];
const mixOf = (n: (tone: ISearchTone) => number) =>
  mixOrder.map((t) => [t, n(t)] as [ISearchTone, number]).filter(([, c]) => c > 0);

/** The counts of some cards per tone, for a mix bar. */
export const toneMix = (cards: ISearchCard[]) => mixOf((t) => count(cards, t));

/** A lane's mix bar: every record its steps read once they tallied them, else its cards. */
export const laneMix = (lane: ILane, cards: ISearchCard[]) =>
  lane.tones ? mixOf((t) => lane.tones![t] ?? 0) : toneMix(cards);
