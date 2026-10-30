/* eslint-disable sonarjs/no-duplicate-string */
import type { ISearchCard, ISearchPlan, IStepState } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangeFeed, StoreChatState } from '../data/agent-chat';
import { boardEventOf } from '../data/stream-events';
import { textOf } from './agent-request';
import { lensKeys } from './lens';
import { metricsOf } from './metrics';
import {
  cardsOf,
  emptyBoard,
  lanesOf,
  reduceBoard,
  sourceText,
  traceOf,
  withBoard,
  type IBoard,
} from './search-board';
import { openClarify, searchesOf, transcriptOf } from './transcript';

const plan: ISearchPlan = {
  id: 'srch1',
  intent: 'project_progress',
  summary: 'project progress "Cockpit"',
  baseId: 'bse1',
  missing: [],
  steps: [
    {
      id: 's1',
      table: { id: 'tblP', name: 'projects' },
      role: 'anchor',
      purpose: 'the project',
      source: { kind: 'search', text: 'Cockpit', filter: undefined },
      limit: 10,
    },
    {
      id: 's2',
      table: { id: 'tblT', name: 'tasks' },
      role: 'related',
      purpose: 'tasks',
      source: { kind: 'follow', from: [{ stepId: 's1', field: 'tasks' }] },
      limit: 50,
    },
    {
      id: 's3',
      table: { id: 'tblC', name: 'contacts' },
      role: 'actor',
      purpose: 'people',
      source: { kind: 'follow', from: [{ stepId: 's2', field: 'assigned_to' }] },
      limit: 50,
    },
  ],
};
const state = (stepId: string, status: IStepState['status'], found = 0): IStepState => ({
  stepId,
  status,
  found,
  shown: found,
});
const card = (stepId: string, recordId: string, extra: Partial<ISearchCard> = {}): ISearchCard => ({
  key: `${stepId}:${recordId}`,
  stepId,
  recordId,
  tableId: plan.steps.find((s) => s.id === stepId)!.table.id,
  table: plan.steps.find((s) => s.id === stepId)!.table.name,
  title: recordId,
  short: null,
  tone: 'none',
  fields: [],
  ...extra,
});
const run = (events: Parameters<typeof reduceBoard>[1][]) =>
  events.reduce<IBoard>((b, e) => reduceBoard(b, e, 1000), emptyBoard('srch1'));

describe('search board (cockpit design §10.3)', () => {
  const pending = plan.steps.map((s) => state(s.id, 'pending'));

  it('opens a lane when its step starts and fills it card by card', () => {
    let board = run([
      { type: 'plan', searchId: 'srch1', plan, states: pending, status: 'running' },
    ]);
    expect(lanesOf(board)).toEqual([]);
    board = run([
      { type: 'plan', searchId: 'srch1', plan, states: pending, status: 'running' },
      { type: 'step', searchId: 'srch1', state: state('s1', 'running') },
    ]);
    expect(lanesOf(board).map((l) => [l.table, l.status])).toEqual([['projects', 'running']]);
    board = reduceBoard(board, { type: 'hit', searchId: 'srch1', card: card('s1', 'recP') });
    board = reduceBoard(board, { type: 'hit', searchId: 'srch1', card: card('s1', 'recP') });
    board = reduceBoard(board, { type: 'step', searchId: 'srch1', state: state('s1', 'done', 1) });
    board = reduceBoard(board, { type: 'step', searchId: 'srch1', state: state('s2', 'running') });
    expect(cardsOf(board, lanesOf(board)[0])).toHaveLength(1);
    expect(lanesOf(board).map((l) => [l.table, l.status, l.found])).toEqual([
      ['projects', 'done', 1],
      ['tasks', 'running', 0],
    ]);
    // a late plan part does not undo what the steps said
    board = reduceBoard(board, {
      type: 'plan',
      searchId: 'srch1',
      plan,
      states: pending,
      status: 'running',
    });
    expect(board.states.s1.status).toBe('done');
    expect(board.times.s1).toEqual({ started: 1000, finished: expect.any(Number) });
  });

  it('traces a card to where it came from and what came from it', () => {
    const board = run([
      {
        type: 'plan',
        searchId: 'srch1',
        plan,
        states: [state('s1', 'done', 1), state('s2', 'done', 1), state('s3', 'done', 1)],
        status: 'done',
      },
      { type: 'hit', searchId: 'srch1', card: card('s1', 'recP') },
      {
        type: 'hit',
        searchId: 'srch1',
        card: card('s2', 'recT', { via: { stepId: 's1', recordId: 'recP', field: 'tasks' } }),
      },
      {
        type: 'hit',
        searchId: 'srch1',
        card: card('s3', 'recC', { via: { stepId: 's2', recordId: 'recT', field: 'assigned_to' } }),
      },
    ]);
    expect([...traceOf(board, 's2:recT')].sort()).toEqual(['s1:recP', 's2:recT', 's3:recC']);
    expect(sourceText(plan, 's2')).toBe('via projects.tasks');
    expect(sourceText(plan, 's1')).toBe('search "Cockpit"');
  });

  it('counts the work for the readout, and brightens what the answer cites', () => {
    const board = run([
      {
        type: 'plan',
        searchId: 'srch1',
        plan,
        states: [state('s1', 'done', 1), state('s2', 'done', 3)],
        status: 'done',
      },
      { type: 'hit', searchId: 'srch1', card: card('s2', 't1', { tone: 'ink' }) },
      { type: 'hit', searchId: 'srch1', card: card('s2', 't2', { tone: 'route' }) },
      { type: 'hit', searchId: 'srch1', card: card('s2', 't3', { tone: 'faint' }) },
      { type: 'lens', searchId: 'srch1', recordKeys: ['s2:t2'] },
    ]);
    const m = Object.fromEntries(metricsOf(board).map((x) => [x.k, [x.v, x.s]]));
    expect(m.DONE).toEqual([1, '50%']);
    expect(m['IN PROGRESS']).toEqual([1, undefined]);
    expect(lensKeys(board, 'answer')).toEqual(new Set(['s2:t2']));
    expect(lensKeys(board, 'retrieved')).toBeUndefined();
  });

  it('counts every task the step read, not only its cards, and each late one once', () => {
    const tally = {
      counted: 132,
      overdue: 3,
      states: [
        { state: 'in-progress', tone: 'route' as const, count: 12 },
        { state: 'onhold', tone: 'caution' as const, count: 4 },
        { state: 'backlog', tone: 'dim' as const, count: 16 },
        { state: 'closed', tone: 'ink' as const, count: 90 },
        { state: 'cancelled', tone: 'faint' as const, count: 10 },
      ],
    };
    const board = run([
      {
        type: 'plan',
        searchId: 'srch1',
        plan,
        states: [
          state('s1', 'done', 1),
          { ...state('s2', 'done', 132), shown: 2, tally },
          state('s3', 'done', 7),
        ],
        status: 'done',
      },
      { type: 'hit', searchId: 'srch1', card: card('s2', 't1', { tone: 'route', alert: true }) },
      { type: 'hit', searchId: 'srch1', card: card('s2', 't2', { tone: 'caution', alert: true }) },
      { type: 'hit', searchId: 'srch1', card: card('s3', 'c1') },
      { type: 'lens', searchId: 'srch1', recordKeys: ['s2:t1', 's2:t2'] },
    ]);
    const all = Object.fromEntries(metricsOf(board).map((x) => [x.k, [x.v, x.s]]));
    expect(all).toMatchObject({
      DONE: [90, '74%'],
      'IN PROGRESS': [12, undefined],
      BACKLOG: [16, undefined],
      'ON HOLD': [4, '3 LATE'],
      PEOPLE: [7, undefined],
    });
    // under the answer's lens: only what it cites, from the cards
    const cited = Object.fromEntries(
      metricsOf(board, lensKeys(board, 'answer')).map((x) => [x.k, [x.v, x.s]])
    );
    expect(cited).toMatchObject({ 'IN PROGRESS': [1, undefined], 'ON HOLD': [1, '2 LATE'] });
    expect(cited.PEOPLE).toEqual([0, undefined]);
    // the lane's mix bar counts the same records
    expect(lanesOf(board)[1].tones).toEqual({ route: 12, caution: 4, dim: 16, ink: 90, faint: 10 });
  });

  it('keeps the server times of a replayed search for the run log', () => {
    const board = reduceBoard(emptyBoard('srch1'), {
      type: 'replay',
      search: {
        id: 'srch1',
        plan,
        status: 'done',
        states: [
          {
            ...state('s1', 'done', 1),
            startedAt: '2026-10-30T04:12:09.000Z',
            finishedAt: '2026-10-30T04:12:10.000Z',
          },
        ],
        cards: [],
        lens: [],
      } as never,
    });
    expect(board.times.s1).toEqual({
      started: Date.parse('2026-10-30T04:12:09.000Z'),
      finished: Date.parse('2026-10-30T04:12:10.000Z'),
    });
  });

  it('stops waiting when the reply ends mid-search, and the plan legs follow the board', () => {
    const live = run([
      {
        type: 'plan',
        searchId: 'srch1',
        plan,
        states: [state('s1', 'done', 1), state('s2', 'running'), state('s3', 'pending')],
        status: 'running',
      },
      { type: 'step', searchId: 'srch1', state: state('s2', 'running') },
    ]);
    const cut = reduceBoard(live, { type: 'cut', searchId: 'srch1' }, 2000);
    expect(cut.status).toBe('cancelled');
    expect(Object.values(cut.states).map((s) => s.status)).toEqual([
      'done',
      'cancelled',
      'skipped',
    ]);
    expect(lanesOf(cut).map((l) => l.status)).toEqual(['done', 'cancelled']);
    expect(cut.times.s2).toEqual({ started: 1000, finished: 2000 });
    // a finished search is left as it is
    const done = { ...cut, status: 'done' as const };
    expect(reduceBoard(done, { type: 'cut', searchId: 'srch1' })).toBe(done);

    const part = {
      searchId: 'srch1',
      plan,
      states: [state('s1', 'done', 1), state('s2', 'running'), state('s3', 'pending')],
      status: 'running' as const,
    };
    expect(withBoard(part, cut)).toMatchObject({
      status: 'cancelled',
      states: [{ status: 'done' }, { status: 'cancelled' }, { status: 'skipped' }],
    });
    expect(withBoard(part, undefined)).toBe(part);
  });

  it('takes only stream parts that fit the contract', () => {
    expect(
      boardEventOf({
        type: 'data-search-step',
        data: { searchId: 's', state: state('s1', 'running') },
      })
    ).toMatchObject({ type: 'step' });
    expect(
      boardEventOf({ type: 'data-search-hit', data: { searchId: 's', card: { key: 'x' } } })
    ).toBeUndefined();
    expect(boardEventOf({ type: 'data-run', data: {} })).toBeUndefined();
  });
});

describe('change feed (cockpit design §10.2)', () => {
  afterEach(() => vi.useRealTimers());

  it('tells React at once, then at most once a window, and never drops the last change', () => {
    vi.useFakeTimers();
    const feed = new ChangeFeed(50);
    const heard = vi.fn();
    feed.subscribe(heard);
    feed.changed();
    expect(heard).toHaveBeenCalledTimes(1);
    feed.changed();
    feed.changed();
    feed.changed();
    expect(heard).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(feed.getVersion()).toBe(2);
    // a flush (a status change) goes out now, with the change still waiting
    feed.changed();
    feed.flush();
    expect(heard).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(200);
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('throttles a streaming reply but not its end', () => {
    vi.useFakeTimers();
    const chat = new StoreChatState([]);
    const heard = vi.fn();
    chat.subscribe(heard);
    const reply = (text: string) =>
      ({ id: 'a1', role: 'assistant', parts: [{ type: 'text', text }] }) as UIMessage;
    chat.pushMessage(reply(''));
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) chat.replaceMessage(0, reply(text));
    expect(heard).toHaveBeenCalledTimes(1);
    chat.setStatus('ready');
    expect(heard).toHaveBeenCalledTimes(2);
    expect(textOf(chat.messages[0])).toBe('Hello');
  });
});

describe('transcript (cockpit design §5.5)', () => {
  const clarify = {
    clarifyId: 'clr1',
    question: 'Which one?',
    reason: 'anchor',
    options: [{ id: 'o1', label: 'Cockpit' }],
  };
  const reply = {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-plan_search',
        toolCallId: 'c1',
        state: 'output-available',
        input: {},
        output: {},
      },
      {
        type: 'data-search-plan',
        id: 'srch1',
        data: { searchId: 'srch1', plan, states: [], status: 'needs_choice' },
      },
      {
        type: 'tool-query_records',
        toolCallId: 'c2',
        state: 'output-available',
        input: {},
        output: {},
      },
      { type: 'data-clarify', id: 'clr1', data: clarify },
      { type: 'text', text: 'Which project?' },
    ],
  } as unknown as UIMessage;

  it('shows plans and questions as their own items, and other tools as rows', () => {
    expect(transcriptOf(reply).map((i) => i.kind)).toEqual(['plan', 'tool', 'clarify', 'text']);
    expect(openClarify([reply])).toEqual(clarify);
    expect(searchesOf([reply]).map((s) => s.searchId)).toEqual(['srch1']);
    const answer = {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'Cockpit' }],
    } as UIMessage;
    expect(openClarify([reply, answer])).toBeUndefined();
  });
});

describe('answers to a question (cockpit design §8)', () => {
  const part = {
    clarifyId: 'clr1',
    question: 'Which project?',
    reason: 'anchor' as const,
    options: [
      {
        id: 'o1',
        label: 'Cybernetics Cockpit',
        recordRef: { tableId: 'tblP', table: 'projects', recordId: 'recP1' },
      },
      { id: 'o2', label: 'Cockpit theme' },
    ],
  };
  it('names one option by its label or its place', async () => {
    const { matchOption, choiceFor } = await import('./transcript');
    expect(matchOption(part, 'the cybernetics cockpit one')?.id).toBe('o1');
    expect(matchOption(part, 'Cockpit theme.')?.id).toBe('o2');
    expect(matchOption(part, 'cockpit')).toBeUndefined();
    expect(matchOption(part, 'the second one')?.id).toBe('o2');
    expect(matchOption(part, 'neither')).toBeUndefined();
    expect(choiceFor('clr1', part.options[0])).toEqual({
      clarifyId: 'clr1',
      optionId: 'o1',
      label: 'Cybernetics Cockpit',
      recordRef: { tableId: 'tblP', table: 'projects', recordId: 'recP1' },
    });
  });
});
