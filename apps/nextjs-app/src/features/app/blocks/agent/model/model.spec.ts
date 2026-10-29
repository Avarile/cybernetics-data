/* eslint-disable sonarjs/no-duplicate-string */
import type { ISearchCard, ISearchPlan, IStepState } from '@teable/openapi';
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { boardEventOf } from '../data/stream-events';
import { lensKeys } from './lens';
import { metricsOf } from './metrics';
import {
  cardsOf,
  emptyBoard,
  lanesOf,
  reduceBoard,
  sourceText,
  traceOf,
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
