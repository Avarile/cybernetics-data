import type {
  IAgentSearchVo,
  ISearchCard,
  ISearchPlan,
  ISearchStatus,
  ISearchView,
  IStepState,
} from '@teable/openapi';

/** One table on the board; steps on the same table share it (cockpit design §5.3). */
export interface ILane {
  tableId: string;
  table: string;
  stepIds: string[];
  /** The lane's state: running while any of its steps runs. */
  status: IStepState['status'];
  found: number;
  shown: number;
  /** The first step's purpose, e.g. "tasks of the project". */
  purpose: string;
  error?: string;
}

export interface IBoard {
  searchId: string;
  plan?: ISearchPlan;
  status: ISearchStatus;
  states: Record<string, IStepState>;
  /** When each step started or finished, for the run log. */
  times: Record<string, { started?: number; finished?: number }>;
  /** Cards in arrival order. */
  cards: ISearchCard[];
  lens: string[];
  view?: ISearchView;
}

export type IBoardEvent =
  | {
      type: 'plan';
      searchId: string;
      plan: ISearchPlan;
      states: IStepState[];
      status: ISearchStatus;
    }
  | { type: 'step'; searchId: string; state: IStepState }
  | { type: 'hit'; searchId: string; card: ISearchCard }
  | { type: 'lens'; searchId: string; recordKeys: string[]; view?: ISearchView }
  | { type: 'replay'; search: IAgentSearchVo };

export const emptyBoard = (searchId: string): IBoard => ({
  searchId,
  status: 'planned',
  states: {},
  times: {},
  cards: [],
  lens: [],
});

const stamp = (board: IBoard, state: IStepState, now: number) => {
  const times = { ...board.times[state.stepId] };
  if (state.status === 'running') times.started ??= now;
  else if (state.status !== 'pending') times.finished ??= now;
  return { ...board.times, [state.stepId]: times };
};

/** The board after one event; plans and states may arrive in any order and more than once. */
export function reduceBoard(board: IBoard, event: IBoardEvent, now = Date.now()): IBoard {
  switch (event.type) {
    case 'plan': {
      const states = { ...board.states };
      let times = board.times;
      for (const s of event.states) {
        // a transient step event may have told more already
        if (!states[s.stepId] || states[s.stepId].status === 'pending') states[s.stepId] = s;
        if (s.status !== 'pending') times = stamp({ ...board, times }, s, now);
      }
      return { ...board, plan: event.plan, states, times, status: event.status };
    }
    case 'step':
      return {
        ...board,
        states: { ...board.states, [event.state.stepId]: event.state },
        times: stamp(board, event.state, now),
      };
    case 'hit':
      if (board.cards.some((c) => c.key === event.card.key)) return board;
      return { ...board, cards: [...board.cards, event.card] };
    case 'lens':
      return { ...board, lens: event.recordKeys, ...(event.view ? { view: event.view } : {}) };
    case 'replay': {
      const s = event.search;
      return {
        ...board,
        plan: s.plan,
        status: s.status,
        states: Object.fromEntries(s.states.map((st) => [st.stepId, st])),
        cards: s.cards,
        lens: s.lens,
      };
    }
  }
}

const laneStatus = (states: IStepState[]): IStepState['status'] => {
  const order: IStepState['status'][] = [
    'running',
    'needs_choice',
    'failed',
    'done',
    'empty',
    'cancelled',
    'skipped',
    'pending',
  ];
  return order.find((s) => states.some((st) => st.status === s)) ?? 'pending';
};

/** The lanes to show: one per table, in plan order, from the moment one of its steps starts. */
export function lanesOf(board: IBoard): ILane[] {
  const lanes: ILane[] = [];
  for (const step of board.plan?.steps ?? []) {
    const state = board.states[step.id];
    if (!state || state.status === 'pending' || state.status === 'skipped') continue;
    let lane = lanes.find((l) => l.tableId === step.table.id);
    if (!lane) {
      lane = {
        tableId: step.table.id,
        table: step.table.name,
        stepIds: [],
        status: 'pending',
        found: 0,
        shown: 0,
        purpose: step.purpose,
      };
      lanes.push(lane);
    }
    lane.stepIds.push(step.id);
    lane.found += state.found;
    lane.shown += state.shown;
    if (state.error) lane.error = state.error;
  }
  for (const lane of lanes) lane.status = laneStatus(lane.stepIds.map((id) => board.states[id]));
  return lanes;
}

export const cardsOf = (board: IBoard, lane: ILane) =>
  board.cards.filter((c) => lane.stepIds.includes(c.stepId));

/** The card a card was reached from (its `via`), if it is on the board. */
export const sourceOf = (board: IBoard, card: ISearchCard) =>
  card.via
    ? board.cards.find((c) => c.key === `${card.via!.stepId}:${card.via!.recordId}`)
    : undefined;

/** Cards linked to `key`: where it came from and what came from it (the hover trace). */
export function traceOf(board: IBoard, key: string): Set<string> {
  const card = board.cards.find((c) => c.key === key);
  if (!card) return new Set();
  const out = new Set([key]);
  const source = sourceOf(board, card);
  if (source) out.add(source.key);
  for (const c of board.cards) {
    if (c.via?.recordId === card.recordId && c.via.stepId === card.stepId) out.add(c.key);
  }
  return out;
}

/** How a step reached its records, in words for the lane header and the plan legs. */
export function sourceText(plan: ISearchPlan | undefined, stepId: string): string {
  const step = plan?.steps.find((s) => s.id === stepId);
  if (!step) return '';
  const tableOf = (id: string) => plan?.steps.find((s) => s.id === id)?.table.name ?? id;
  switch (step.source.kind) {
    case 'search':
      return `search "${step.source.text}"`;
    case 'records':
      return `${step.source.recordIds.length} picked`;
    case 'filter':
      return 'filter';
    case 'follow':
      return `via ${step.source.from.map((f) => `${tableOf(f.stepId)}.${f.field}`).join(' + ')}`;
    case 'reverse':
      return `linked to ${step.source.from.map((f) => `${tableOf(f.stepId)} (${f.field})`).join(' + ')}`;
  }
}
