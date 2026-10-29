import type { ISearchCard, ISearchPlan } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { emptyBoard, type IBoard } from '../search-board';
import { boardToGraph } from './from-board';
import { labelTransform, layoutGraph } from './layout';
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

  it('lays out every drawn node on the rim, with bundled edges and readable labels', () => {
    const g = boardToGraph(board);
    const layout = layoutGraph(g, { mode: 'bundle', radius: 300 });
    expect(layout.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['root', 'G', 'P', 'T1', 'g:people', 'A'])
    );
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges.every((e) => e.d.startsWith('M'))).toBe(true);
    const left = layout.nodes.find((n) => n.angle > Math.PI)!;
    expect(labelTransform(left, 6).anchor).toBe('end');
    const narrowed = layoutGraph(g, { mode: 'tree', radius: 300, lens: new Set(['T1']) });
    expect(narrowed.nodes.map((n) => n.id).sort()).toEqual(
      ['G', 'P', 'T1', 'g:people', 'root'].sort()
    );
    expect(narrowed.nodes.find((n) => n.id === 'P')?.context).toBe(true);
    expect(narrowed.branches.length).toBeGreaterThan(0);
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
    const limited = limitGraph(finishGraph({ title: 't', nodes, links: [] }), 11);
    expect(limited.shown).toBe(9);
    expect(limited.hidden).toBe(21);
    expect(limited.graph.byId.has('n7')).toBe(true);
    expect(limited.graph.byId.get('more:hub')?.label).toBe('+21 more');
  });
});
