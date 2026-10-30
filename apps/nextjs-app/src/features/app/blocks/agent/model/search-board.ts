import type {
  IAgentSearchVo,
  ISearchCard,
  ISearchPlan,
  ISearchPlanPart,
  ISearchStatus,
  ISearchTone,
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
  /** Records per tone over all its steps read, once every step tallied them. */
  tones?: Partial<Record<ISearchTone, number>>;
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
  /** `view` is the stage's view the answer asks for; the stage follows it (useStage). */
  | { type: 'lens'; searchId: string; recordKeys: string[]; view?: ISearchView }
  | { type: 'replay'; search: IAgentSearchVo }
  /** The reply ended before the search did (Stop, a dropped connection): nothing more comes. */
  | { type: 'cut'; searchId: string };

export const emptyBoard = (searchId: string): IBoard => ({
  searchId,
  status: 'planned',
  states: {},
  times: {},
  cards: [],
  lens: [],
});

const at = (iso?: string) => (iso ? Date.parse(iso) : undefined);

/** When a step ran: the server's times when it sent them, else when the client heard. */
const stamp = (board: IBoard, state: IStepState, now: number) => {
  const times = { ...board.times[state.stepId] };
  times.started ??= at(state.startedAt) ?? (state.status === 'running' ? now : undefined);
  if (state.status !== 'running' && state.status !== 'pending')
    times.finished ??= at(state.finishedAt) ?? now;
  return { ...board.times, [state.stepId]: times };
};

const withPlan = (board: IBoard, event: Extract<IBoardEvent, { type: 'plan' }>, now: number) => {
  const states = { ...board.states };
  let times = board.times;
  for (const s of event.states) {
    // a transient step event may have told more already
    if (!states[s.stepId] || states[s.stepId].status === 'pending') states[s.stepId] = s;
    if (s.status !== 'pending') times = stamp({ ...board, times }, s, now);
  }
  return { ...board, plan: event.plan, states, times, status: event.status };
};

const replayed = (board: IBoard, s: IAgentSearchVo): IBoard => ({
  ...board,
  plan: s.plan,
  status: s.status,
  states: Object.fromEntries(s.states.map((st) => [st.stepId, st])),
  times: Object.fromEntries(
    s.states.map((st) => [st.stepId, { started: at(st.startedAt), finished: at(st.finishedAt) }])
  ),
  cards: s.cards,
  lens: s.lens,
});

/** What was running stopped with the reply; what had not started never will. */
const cut = (board: IBoard, now: number): IBoard => {
  if (board.status !== 'running' && board.status !== 'planned') return board;
  const states = { ...board.states };
  let times = board.times;
  for (const [id, st] of Object.entries(states)) {
    if (st.status !== 'running' && st.status !== 'pending') continue;
    states[id] = { ...st, status: st.status === 'running' ? 'cancelled' : 'skipped' };
    times = stamp({ ...board, times }, states[id], now);
  }
  return { ...board, states, times, status: 'cancelled' };
};

/** The board after one event; plans and states may arrive in any order and more than once. */
export function reduceBoard(board: IBoard, event: IBoardEvent, now = Date.now()): IBoard {
  switch (event.type) {
    case 'plan':
      return withPlan(board, event, now);
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
      return { ...board, lens: event.recordKeys };
    case 'replay':
      return replayed(board, event.search);
    case 'cut':
      return cut(board, now);
  }
}

/** A stored plan part as the live board knows it, which is never behind the part. */
export function withBoard(part: ISearchPlanPart, board: IBoard | undefined): ISearchPlanPart {
  if (!board?.plan) return part;
  return {
    ...part,
    status: board.status,
    states: part.plan.steps.map(
      (s) =>
        board.states[s.id] ??
        part.states.find((st) => st.stepId === s.id) ?? {
          stepId: s.id,
          status: 'pending',
          found: 0,
          shown: 0,
        }
    ),
  };
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
  for (const lane of lanes) {
    const states = lane.stepIds.map((id) => board.states[id]);
    lane.status = laneStatus(states);
    if (!states.every((st) => st.tally)) continue;
    const tones: Partial<Record<ISearchTone, number>> = {};
    for (const row of states.flatMap((st) => st.tally!.states))
      tones[row.tone] = (tones[row.tone] ?? 0) + row.count;
    lane.tones = tones;
  }
  return lanes;
}

export const cardsOf = (board: IBoard, lane: ILane) =>
  board.cards.filter((c) => lane.stepIds.includes(c.stepId));

/** The board's cards by key, so a card's source is found without a scan. */
export const cardIndex = (board: IBoard) => new Map(board.cards.map((c) => [c.key, c]));

/** The card a card was reached from (its `via`), if it is on the board. */
export const sourceOf = (cards: Map<string, ISearchCard>, card: ISearchCard) =>
  card.via ? cards.get(`${card.via.stepId}:${card.via.recordId}`) : undefined;

/** Cards linked to `key`: where it came from and what came from it (the hover trace). */
export function traceOf(board: IBoard, key: string): Set<string> {
  const cards = cardIndex(board);
  const card = cards.get(key);
  if (!card) return new Set();
  const out = new Set([key]);
  const source = sourceOf(cards, card);
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
