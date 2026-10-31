/* eslint-disable sonarjs/no-duplicate-string */
import type { IOverviewGraphVo, IOverviewNode } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { logTime } from './format';
import { overviewToGraph } from './overview/from-overview';
import type { ITableInfo } from './overview/presentation';
import { overviewVectors } from './panels';

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
const vo = (title: string, nodes: IOverviewNode[]): IOverviewGraphVo => ({
  title,
  path: '',
  baseId: 'bse1',
  nodes,
  links: [],
  counts: {},
  missing: [],
  truncated: false,
});
/** What the server sends with the WORK and FINANCE presets. */
const info: Record<'work' | 'finance', Pick<ITableInfo, 'toneNames' | 'unit' | 'right'>> = {
  work: {
    unit: 'ITEMS',
    right: 'pct',
    toneNames: {
      route: 'IN PROGRESS',
      target: 'PLANNED',
      dim: 'BACKLOG',
      ink: 'FINISHED',
      caution: 'ON HOLD',
      faint: 'CANCELLED',
    },
  },
  finance: {
    unit: 'TRANSACTIONS',
    right: 'sum',
    toneNames: { route: 'EXPENSE', target: 'INCOME', dim: 'TRANSFER' },
  },
};
const datasetInfo = (id: 'work' | 'finance') => info[id];

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

  it('shows the money a finance branch moved', () => {
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
  });

  it('dates the log in UTC: the time today, the day before, dashes before it ran', () => {
    const now = Date.parse('2026-10-30T20:00:00Z');
    expect(logTime(Date.parse('2026-10-30T04:12:00Z'), now)).toBe('04:12');
    expect(logTime(Date.parse('2026-10-29T23:59:00Z'), now)).toBe('10-29');
    expect(logTime(0, now)).toBe('--:--');
  });
});
