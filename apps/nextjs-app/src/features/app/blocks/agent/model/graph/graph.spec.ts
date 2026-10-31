import { describe, expect, it } from 'vitest';
import { TAU, buildTree, geometry, labelFit, labelOf, layoutTree } from './layout';
import { limitGraph } from './limit';
import { finishGraph, type IGNode } from './types';

/** Goal → project → two tasks, and the people the tasks are assigned to on their branch. */
const node = (
  id: string,
  kind: IGNode['kind'],
  parent: string | null,
  tone: IGNode['tone'] = 'none'
): IGNode => ({ id, kind, label: id, short: null, parent, tone });
const g = finishGraph({
  title: 'Cockpit',
  nodes: [
    node('G', 'hub', null),
    node('P', 'hub', 'G'),
    node('T1', 'item', 'P', 'route'),
    node('T2', 'item', 'P', 'ink'),
    { ...node('g:people', 'hub', null), label: 'Contacts', short: 'CONTACTS' },
    node('A', 'actor', 'g:people'),
    node('B', 'actor', 'g:people'),
  ],
  links: [
    { id: 'B|T1', source: 'B', target: 'T1', tone: 'route', label: 'assigned_to' },
    { id: 'A|T2', source: 'A', target: 'T2', tone: 'ink', label: 'assigned_to' },
  ],
});

describe('constellation graph (cockpit design §5.4)', () => {
  it('lays the tree out on a ring sized to its box, with room for labels when there is room', () => {
    const data = buildTree(g, null);
    const h = layoutTree(data, 'bundle', 200);
    expect(h.descendants().map((d) => d.data.id)).toEqual(
      expect.arrayContaining(['root', 'G', 'P', 'T1', 'g:people', 'A'])
    );
    // cluster: every leaf on the ring, angles around the whole turn
    expect(h.leaves().every((d) => Math.abs(d.y - 200) < 1e-9)).toBe(true);
    expect(h.leaves().every((d) => d.x >= 0 && d.x <= TAU)).toBe(true);
    const wide = geometry(1200, 800, h.leaves().length);
    expect(wide).toMatchObject({ cx: 600, cy: 404, r: 374, narrow: false });
    // full-bleed: centred in the free area, the ring clear of the readout's corner
    const framed = geometry(1200, 800, 10, { x0: 300, x1: 1100, clear: { x: 400, y: 500 } });
    expect(framed).toMatchObject({ cx: 700, cy: 400, r: 288 });
    expect(wide.rIn).toBeLessThan(wide.r);
    expect(geometry(390, 600, 10).narrow).toBe(true);
    const fit = labelFit(wide, h.leaves().length, false);
    expect([fit.hidden, fit.withName]).toEqual([false, true]);
    expect(labelOf({ ...g.byId.get('T1')!, short: 'TASK · #4' }, fit)).toBe('TASK · #4 T1');
    expect(labelFit(geometry(390, 600, 10), 10, false).hidden).toBe(true);
  });

  it('narrows the tree to a lens, its branches kept faint and empty ones gone', () => {
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
