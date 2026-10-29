import type { ISearchCard, ISearchTone } from '@teable/openapi';
import type { IBoard } from './search-board';

export interface IMetric {
  k: string;
  v: number | string;
  s?: string;
  tone: ISearchTone;
}

const count = (cards: ISearchCard[], tone: ISearchTone) =>
  cards.filter((c) => c.tone === tone).length;
const tableCards = (board: IBoard, table: string) => {
  const ids = new Set(board.plan?.steps.filter((s) => s.table.name === table).map((s) => s.id));
  return board.cards.filter((c) => ids.has(c.stepId));
};

/**
 * The readout's numbers (cockpit design §5.6), counted from the cards on the board. Progress
 * questions count the work by state; anything else counts records per table.
 */
export function metricsOf(board: IBoard, lens?: Set<string>): IMetric[] {
  const cards = lens ? board.cards.filter((c) => lens.has(c.key)) : board.cards;
  const plan = board.plan;
  if (!plan) return [];
  const work = plan.intent === 'goal_progress' || plan.intent === 'project_progress';
  if (work) {
    const tasks = tableCards({ ...board, cards }, 'tasks');
    const live = tasks.length - count(tasks, 'faint');
    const done = count(tasks, 'ink');
    const out: IMetric[] = [
      {
        k: 'DONE',
        v: done,
        s: live ? `${Math.round((done / live) * 100)}%` : undefined,
        tone: 'ink',
      },
      { k: 'IN PROGRESS', v: count(tasks, 'route'), tone: 'route' },
      { k: 'NEXT', v: count(tasks, 'target'), tone: 'target' },
      { k: 'BACKLOG', v: count(tasks, 'dim'), tone: 'dim' },
      {
        k: 'ON HOLD',
        v: count(tasks, 'caution') + tasks.filter((t) => t.alert).length,
        tone: 'caution',
      },
      { k: 'PEOPLE', v: tableCards({ ...board, cards }, 'contacts').length, tone: 'ink' },
      { k: 'KNOWLEDGE', v: tableCards({ ...board, cards }, 'knowledges').length, tone: 'ink' },
    ];
    return out;
  }
  const byTable = new Map<string, number>();
  for (const c of cards) byTable.set(c.table, (byTable.get(c.table) ?? 0) + 1);
  return [...byTable]
    .slice(0, 7)
    .map(([table, n]) => ({ k: table.toUpperCase(), v: n, tone: 'ink' as ISearchTone }));
}

/** The counts of a lane's cards per tone, for its mix bar. */
export function toneMix(cards: ISearchCard[]): [ISearchTone, number][] {
  const order: ISearchTone[] = ['ink', 'route', 'target', 'caution', 'dim', 'faint', 'none'];
  return order.map((t) => [t, count(cards, t)] as [ISearchTone, number]).filter(([, n]) => n > 0);
}
