import type { ISearchCard, ISearchPlan } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { emptyBoard, type IBoard } from '../search-board';
import { boardToGraph } from './from-board';
import { TAU, buildTree, geometry, labelFit, labelOf, layoutTree } from './layout';
import { limitGraph } from './limit';
import { finishGraph, type IGNode } from './types';

const step = (id: string, name: string, role: ISearchPlan['steps'][number]['role']) => ({
  id,
  table: { id: `tbl_${name}`, name },
  role,
  purpose: '',
  source: { kind: 'search' as const, text: 'x', filter: undefined },
  limit: 50,
});
const plan: ISearchPlan = {
  id: 'srch1',
  intent: 'project_progress',
  summary: 'Cockpit',
  baseId: 'bse1',
  missing: [],
  steps: [
    step('s1', 'projects', 'anchor'),
    step('s2', 'tasks', 'related'),
    step('s3', 'contacts', 'actor'),
    step('s5', 'goals', 'context'),
  ],
};
const card = (stepId: string, recordId: string, extra: Partial<ISearchCard> = {}): ISearchCard => ({
  key: `${stepId}:${recordId}`,
  stepId,
  recordId,
  tableId: 't',
  table: plan.steps.find((s) => s.id === stepId)!.table.name,
  title: recordId,
  short: null,
  tone: 'none',
  fields: [],
  ...extra,
});
const board: IBoard = {
  ...emptyBoard('srch1'),
  plan,
  status: 'done',
  cards: [
    card('s1', 'P', { links: { belong_goals: ['G'], lead_by: ['A'], tasks: ['T1', 'T2'] } }),
    card('s2', 'T1', {
      tone: 'route',
      via: { stepId: 's1', recordId: 'P', field: 'tasks' },
      links: { assigned_to: ['B'], belong_project: ['P'] },
    }),
    card('s2', 'T2', {
      tone: 'ink',
      via: { stepId: 's1', recordId: 'P', field: 'tasks' },
      links: { assigned_to: ['A'] },
    }),
    card('s3', 'A', { via: { stepId: 's2', recordId: 'T2', field: 'assigned_to' } }),
    card('s3', 'B', { via: { stepId: 's2', recordId: 'T1', field: 'assigned_to' } }),
    card('s5', 'G', { via: { stepId: 's1', recordId: 'P', field: 'belong_goals' } }),
  ],
};

describe('constellation graph (cockpit design §5.4)', () => {
  it('follows the plan: goal → project → tasks, people on their branch, links as edges', () => {
    const g = boardToGraph(board);
    const parent = (id: string) => g.byId.get(id)?.parent;
    expect([parent('G'), parent('P'), parent('T1'), parent('A')]).toEqual([
      null,
      'G',
      'P',
      'g:people',
    ]);
    expect(g.byId.get('A')?.kind).toBe('actor');
    expect(g.byId.get('G')?.kind).toBe('hub');
    expect(g.links.map((l) => l.id).sort()).toEqual(['A|P', 'A|T2', 'B|T1']);
    expect(g.branches.find((b) => b.id === 'G')).toMatchObject({ count: 3 });
  });

  it('names the people branch by its tables, and hangs a record whose source is not shown', () => {
    const g = boardToGraph({
      ...board,
      cards: [
        ...board.cards.map((c) =>
          c.recordId === 'P' ? { ...c, links: { ...c.links, tasks: ['T1', 'T2', 'T3'] } } : c
        ),
        // reached from a task the board does not show, but the project links to it
        card('s2', 'T3', { via: { stepId: 's1', recordId: 'Pgone', field: 'tasks' } }),
        card('s2', 'T4', { via: { stepId: 's1', recordId: 'Pgone', field: 'tasks' } }),
      ],
    });
    expect(g.byId.get('g:people')).toMatchObject({ label: 'Contacts', short: 'CONTACTS' });
    expect(g.byId.get('T3')?.parent).toBe('P');
    expect(g.byId.get('T4')?.parent).toBeNull();
  });

  it('lays the tree out on a ring sized to its box, with room for labels when there is room', () => {
    const g = boardToGraph(board);
    const data = buildTree(g, null);
    const h = layoutTree(data, 'bundle', 200);
    expect(h.descendants().map((d) => d.data.id)).toEqual(
      expect.arrayContaining(['root', 'G', 'P', 'T1', 'g:people', 'A'])
    );
    // cluster: every leaf on the ring, angles around the whole turn
    expect(h.leaves().every((d) => Math.abs(d.y - 200) < 1e-9)).toBe(true);
    expect(h.leaves().every((d) => d.x >= 0 && d.x <= TAU)).toBe(true);
    const wide = geometry(1200, 800, h.leaves().length);
    expect(wide).toMatchObject({ cx: 600, cy: 400, r: 382, narrow: false });
    expect(wide.rIn).toBeLessThan(wide.r);
    expect(geometry(390, 600, 10).narrow).toBe(true);
    const fit = labelFit(wide, h.leaves().length, false);
    expect([fit.hidden, fit.withName]).toEqual([false, true]);
    expect(labelOf({ ...g.byId.get('T1')!, short: 'TASK · #4' }, fit)).toBe('TASK · #4 T1');
    expect(labelFit(geometry(390, 600, 10), 10, false).hidden).toBe(true);
  });

  it('narrows the tree to a lens, its branches kept faint and empty ones gone', () => {
    const g = boardToGraph(board);
    const narrowed = layoutTree(buildTree(g, new Set(['T1'])), 'tree', 200);
    // the people's branch cites no one: it is not drawn
    expect(
      narrowed
        .descendants()
        .map((d) => d.data.id)
        .sort()
    ).toEqual(['G', 'P', 'T1', 'root'].sort());
    expect(narrowed.descendants().find((d) => d.data.id === 'P')?.data.context).toBe(true);
  });

  it('draws within the budget and folds the rest into "+N more"', () => {
    const nodes: IGNode[] = [
      { id: 'hub', kind: 'hub', label: 'h', short: null, parent: null, tone: 'none' },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `n${i}`,
        kind: 'item' as const,
        label: `n${i}`,
        short: null,
        parent: 'hub',
        tone: (i === 7 ? 'caution' : 'ink') as IGNode['tone'],
      })),
    ];
    const g = finishGraph({ title: 't', nodes, links: [] });
    const limited = limitGraph(g, { budget: 11 });
    expect(limited.shown).toBe(9);
    expect(limited.hidden).toBe(21);
    expect(limited.graph.byId.has('n7')).toBe(true);
    expect(limited.graph.byId.get('more:hub')?.label).toBe('+21 more');

    // the answer cites two records the budget would drop: under the lens they are what draws
    expect(limitGraph(g, { budget: 3 }).graph.byId.has('n3')).toBe(false);
    const lensed = limitGraph(g, { budget: 3, lens: new Set(['n3', 'n20']) });
    expect([lensed.total, lensed.shown, lensed.hidden]).toEqual([2, 2, 0]);
    expect([...lensed.graph.byId.keys()].sort()).toEqual(['hub', 'n20', 'n3']);
  });
});
