/* eslint-disable sonarjs/no-duplicate-string */
import type { IAgentOverviewVo, IOverviewNode, ISearchCard, ISearchPlan } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { logTime } from './format';
import { datasetInfo } from './overview/datasets';
import { overviewToGraph } from './overview/from-overview';
import { overviewFeed, overviewVectors, searchFeed, searchVectors } from './panels';
import { emptyBoard, reduceBoard, type IBoard } from './search-board';

const node = (id: string, extra: Partial<IOverviewNode> = {}): IOverviewNode => ({
  id,
  kind: 'item',
  label: id,
  short: null,
  parent: null,
  tone: 'none',
  ...extra,
});
const rec = (table: string, id: string, extra: Partial<IOverviewNode> = {}) =>
  node(`rec:${id}`, { recordId: id, table, short: table.slice(0, -1).toUpperCase(), ...extra });
const vo = (dataset: IAgentOverviewVo['dataset'], nodes: IOverviewNode[]): IAgentOverviewVo => ({
  dataset,
  title: dataset.toUpperCase(),
  path: '',
  baseId: 'bse1',
  nodes,
  links: [],
  counts: {},
  missing: [],
  truncated: false,
  builtAt: '2026-10-30T00:00:00.000Z',
});

describe('rail panels of the overview (the cockpit panels.ts)', () => {
  it('sums each branch as a vector: count, tones, alerts, share done and its mix', () => {
    const work = vo('work', [
      rec('goals', 'G', { kind: 'hub', label: 'Ship' }),
      rec('projects', 'P', { parent: 'rec:G', tone: 'route' }),
      rec('tasks', 'T1', { parent: 'rec:P', tone: 'route' }),
      rec('tasks', 'T2', { parent: 'rec:P', tone: 'ink' }),
      rec('tasks', 'T3', { parent: 'rec:P', tone: 'faint' }),
      rec('tasks', 'T4', { parent: 'rec:P', tone: 'caution', alert: true }),
      node('hub:none', { kind: 'hub', label: 'Unplanned', short: 'NONE' }),
      rec('tasks', 'T5', { parent: 'hub:none', tone: 'target' }),
      node('hub:empty', { kind: 'hub', label: 'Empty' }),
    ]);
    const vectors = overviewVectors(overviewToGraph(work), datasetInfo('work'));
    expect(vectors).toEqual([
      {
        id: 'rec:G',
        label: 'Ship',
        right: '25%',
        stack: [
          ['ink', 1],
          ['route', 2],
          ['caution', 1],
          ['faint', 1],
        ],
        facts: [
          { text: '5 ITEMS' },
          { text: '2 IN PROGRESS', tone: 'route' },
          { text: '1 ON HOLD', tone: 'caution' },
        ],
      },
      {
        id: 'hub:none',
        label: 'Unplanned',
        short: 'NONE',
        right: '0%',
        stack: [['target', 1]],
        facts: [{ text: '1 ITEMS' }, { text: '1 PLANNED', tone: 'target' }],
      },
    ]);
  });

  it('shows the money a finance branch moved, and its latest transactions as the log', () => {
    const finance = vo('finance', [
      node('hub:food', { kind: 'hub', label: 'Food' }),
      rec('transactions', 'X1', {
        parent: 'hub:food',
        label: 'Lunch',
        tone: 'route',
        amount: -12,
        date: '2026-10-29',
      }),
      rec('transactions', 'X2', {
        parent: 'hub:food',
        label: 'Refund',
        tone: 'target',
        amount: 30,
        date: '2026-10-30',
      }),
      rec('transactions', 'X3', { parent: 'hub:food', label: 'Undated', tone: 'route' }),
    ]);
    const info = datasetInfo('finance');
    expect(overviewVectors(overviewToGraph(finance), info)[0].right).toBe('42');
    expect(overviewFeed(finance, info)).toEqual([
      expect.objectContaining({
        id: 'rec:X2',
        verb: 'INCOME',
        key: 'TRANSACTION',
        text: 'Refund · 30',
      }),
      expect.objectContaining({ id: 'rec:X1', verb: 'EXPENSE', tone: 'route', text: 'Lunch · 12' }),
    ]);
  });

  it('words a work record by its tone, not the first word of its state', () => {
    const work = vo('work', [
      rec('tasks', 'T1', { tone: 'route', state: 'in-progress', date: '2026-10-30' }),
    ]);
    expect(overviewFeed(work, datasetInfo('work'))[0].verb).toBe('ACTIVE');
  });

  it('dates the log in UTC: the time today, the day before, dashes before it ran', () => {
    const now = Date.parse('2026-10-30T20:00:00Z');
    expect(logTime(Date.parse('2026-10-30T04:12:00Z'), now)).toBe('04:12');
    expect(logTime(Date.parse('2026-10-29T23:59:00Z'), now)).toBe('10-29');
    expect(logTime(0, now)).toBe('--:--');
  });
});

describe('rail panels of a search', () => {
  const plan: ISearchPlan = {
    id: 'srch1',
    intent: 'project_progress',
    summary: 'Cockpit',
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
    ],
  };
  const card = (stepId: string, recordId: string, tone: ISearchCard['tone']): ISearchCard => ({
    key: `${stepId}:${recordId}`,
    stepId,
    recordId,
    tableId: stepId === 's1' ? 'tblP' : 'tblT',
    table: stepId === 's1' ? 'projects' : 'tasks',
    title: recordId,
    short: null,
    tone,
    fields: [],
  });
  const board = [
    {
      type: 'plan' as const,
      searchId: 'srch1',
      plan,
      states: [
        { stepId: 's1', status: 'done' as const, found: 1, shown: 1 },
        { stepId: 's2', status: 'running' as const, found: 5, shown: 2 },
      ],
      status: 'running' as const,
    },
    { type: 'hit' as const, searchId: 'srch1', card: card('s1', 'recP', 'route') },
    { type: 'hit' as const, searchId: 'srch1', card: card('s2', 'recT1', 'ink') },
    { type: 'hit' as const, searchId: 'srch1', card: card('s2', 'recT2', 'route') },
  ].reduce<IBoard>((b, e) => reduceBoard(b, e, 1000), emptyBoard('srch1'));

  it('makes a vector of each table searched: what it found and its mix', () => {
    expect(searchVectors(board)).toEqual([
      expect.objectContaining({ id: 'tblP', label: 'PROJECTS', right: '1', stack: [['route', 1]] }),
      expect.objectContaining({
        id: 'tblT',
        label: 'TASKS',
        right: '2/5',
        stack: [
          ['ink', 1],
          ['route', 1],
        ],
      }),
    ]);
  });

  it('logs each step with how it reached its table and what it found', () => {
    const [first, second] = searchFeed(board);
    expect(first).toMatchObject({ verb: 'SEARCH', tone: 'ink', key: 'projects' });
    expect(first.text).toBe('search "Cockpit" → done 1');
    expect(second).toMatchObject({ verb: 'FOLLOW', tone: 'route', key: 'tasks' });
    expect(second.text).toBe('via projects.tasks → running 5');
  });
});
