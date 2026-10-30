/* eslint-disable sonarjs/no-duplicate-string */
import type { IAgentOverviewVo, IOverviewNode } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { traceGraph } from '../graph/trace';
import {
  currentDataset,
  nextDataset,
  reduceCycle,
  remainingAt,
  running,
  startCycle,
  type ICycle,
  type ICycleEvent,
} from './cycle';
import { DATASET_MS } from './datasets';
import { overviewToGraph } from './from-overview';
import { overviewMetrics } from './metrics';

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
  node(`rec:${id}`, { recordId: id, table, ...extra });
const vo = (
  dataset: IAgentOverviewVo['dataset'],
  nodes: IOverviewNode[],
  extra: Partial<IAgentOverviewVo> = {}
): IAgentOverviewVo => ({
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
  ...extra,
});

const work = vo(
  'work',
  [
    rec('goals', 'G', { kind: 'hub', alert: true, date: '2026-01-01' }),
    rec('projects', 'P', { parent: 'rec:G', tone: 'route' }),
    rec('tasks', 'T1', { parent: 'rec:P', tone: 'route', state: 'in-progress' }),
    rec('tasks', 'T2', { parent: 'rec:P', tone: 'ink' }),
    rec('tasks', 'T3', { parent: 'rec:P', tone: 'faint' }),
    rec('tasks', 'T4', { parent: 'rec:P', tone: 'caution' }),
    node('hub:tblContacts', { kind: 'hub', label: 'PEOPLE' }),
    rec('contacts', 'C', { kind: 'actor', parent: 'hub:tblContacts' }),
  ],
  {
    links: [
      {
        id: 'rec:C|rec:T1',
        source: 'rec:C',
        target: 'rec:T1',
        tone: 'route',
        label: 'assigned_to',
      },
    ],
  }
);

describe('overview model (overview design §9.1)', () => {
  it('adapts a dataset to the constellation graph', () => {
    const g = overviewToGraph(work);
    expect(g.byId.get('rec:T1')).toMatchObject({
      state: 'IN-PROGRESS',
      recordId: 'T1',
      table: 'tasks',
    });
    expect(g.byId.get('rec:G')?.date).toBe(Date.parse('2026-01-01'));
    expect(g.kids.get('rec:P')).toHaveLength(4);
    expect(g.links).toHaveLength(1);
  });

  it('counts each dataset for the readout', () => {
    const m = (v: IAgentOverviewVo) =>
      Object.fromEntries(overviewMetrics(v).map((x) => [x.k, [x.v, x.s]]));
    expect(m(work)).toMatchObject({
      GOALS: [1, undefined],
      TASKS: [4, undefined],
      'IN PROGRESS': [1, undefined],
      'ON HOLD': [1, '1 LATE'],
      DONE: ['33%', undefined],
    });
    const knowledge = vo('knowledge', [
      rec('knowledge_type', 'K', { kind: 'hub' }),
      rec('knowledges', 'E1', { parent: 'rec:K', tone: 'route' }),
      rec('knowledges', 'E2', { parent: 'hub:tblKnowledges', tone: 'ink' }),
    ]);
    expect(m(knowledge)).toMatchObject({
      ENTRIES: [2, undefined],
      'UPDATED 7D': [1, undefined],
      UNTYPED: [1, undefined],
    });
    const people = vo('people', [rec('contacts', 'C', { kind: 'hub' })], {
      counts: { 'tasks.unplaced': 3 },
    });
    expect(m(people)).toMatchObject({ PEOPLE: [1, undefined], UNASSIGNED: [3, undefined] });
    const finance = vo('finance', [
      rec('finance_Transactions', 'X1', { tone: 'route', amount: 30 }),
      rec('finance_Transactions', 'X2', { tone: 'route', amount: 70 }),
      rec('finance_Transactions', 'X3', { tone: 'target', amount: 40 }),
    ]);
    const f = overviewMetrics(finance);
    expect(f.find((x) => x.k === 'NET')).toMatchObject({ tone: 'caution' });
    expect(f.find((x) => x.k === 'TRANSACTIONS 90D')?.v).toBe(3);
  });

  it('traces a node to its branch, its children and what its edges reach', () => {
    const g = overviewToGraph(work);
    expect([...traceGraph(g, 'rec:C')].sort()).toEqual(['hub:tblContacts', 'rec:C', 'rec:T1']);
    expect(traceGraph(g, 'rec:P').has('rec:T4')).toBe(true);
    expect(traceGraph(g, 'nope').size).toBe(0);
  });
});

describe('overview cycle (overview design §6)', () => {
  const order = ['work', 'knowledge', 'people', 'finance'] as const;
  const run = (events: [ICycleEvent, number][], from: ICycle = startCycle([...order])) =>
    events.reduce((c, [e, at]) => reduceCycle(c, e, at), from);

  it('starts the minute when the dataset is drawn, then moves on', () => {
    let c = run([[{ type: 'drawn' }, 5_000]]);
    expect(running(c)).toBe(true);
    expect(remainingAt(c, 5_000 + 20_000)).toBe(DATASET_MS - 20_000);
    c = reduceCycle(c, { type: 'tick' }, 5_000 + DATASET_MS);
    expect([currentDataset(c), c.drawn, c.remaining]).toEqual(['knowledge', false, DATASET_MS]);
    expect(nextDataset(c)).toBe('people');
    // an early tick changes nothing
    c = run(
      [
        [{ type: 'drawn' }, 0],
        [{ type: 'tick' }, 10_000],
      ],
      c
    );
    expect(currentDataset(c)).toBe('knowledge');
  });

  it('keeps the time left through a hold, and a hidden tab or pointer holds too', () => {
    let c = run([
      [{ type: 'drawn' }, 0],
      [{ type: 'hold', reason: 'pointer' }, 15_000],
    ]);
    expect(running(c)).toBe(false);
    expect(remainingAt(c, 500_000)).toBe(DATASET_MS - 15_000);
    c = run(
      [
        [{ type: 'hold', reason: 'hidden' }, 20_000],
        [{ type: 'release', reason: 'pointer' }, 30_000],
      ],
      c
    );
    expect(running(c)).toBe(false);
    c = reduceCycle(c, { type: 'release', reason: 'hidden' }, 40_000);
    expect(remainingAt(c, 50_000)).toBe(DATASET_MS - 15_000 - 10_000);
  });

  it('shows a picked dataset at once and holds it until resumed', () => {
    let c = run([
      [{ type: 'drawn' }, 0],
      [{ type: 'pick', id: 'finance' }, 10_000],
      [{ type: 'drawn' }, 11_000],
    ]);
    expect([currentDataset(c), c.holds, running(c)]).toEqual(['finance', ['picked'], false]);
    c = reduceCycle(c, { type: 'resume' }, 70_000);
    expect(remainingAt(c, 70_000)).toBe(DATASET_MS);
    expect(reduceCycle(c, { type: 'tick' }, 70_000 + DATASET_MS).index).toBe(0);
  });

  it('gives the overview a fresh minute when it comes back, and forgets a stale pointer', () => {
    const c = run([
      [{ type: 'drawn' }, 0],
      [{ type: 'hold', reason: 'pointer' }, 30_000],
      [{ type: 'restart' }, 500_000],
    ]);
    expect([c.remaining, c.drawn, c.holds]).toEqual([DATASET_MS, false, []]);
    expect(currentDataset(c)).toBe('work');
  });

  it('skips datasets that cannot be shown, staying on the current one when it can', () => {
    let c = run([[{ type: 'available', order: ['work', 'finance'] }, 0]]);
    expect([currentDataset(c), nextDataset(c)]).toEqual(['work', 'finance']);
    c = run([[{ type: 'available', order: ['knowledge'] }, 0]], c);
    expect([currentDataset(c), nextDataset(c)]).toEqual(['knowledge', undefined]);
    // one dataset alone never cycles
    expect(running(reduceCycle(c, { type: 'drawn' }, 0))).toBe(false);
  });
});
