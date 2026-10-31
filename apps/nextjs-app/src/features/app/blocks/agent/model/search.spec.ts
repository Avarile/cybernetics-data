import type { ICockpitSearchResult, IOverviewNode } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { limitGraph } from './graph/limit';
import { mergeNodes } from './graph/merge';
import { finishGraph, type IGNode } from './graph/types';
import { FORCED_MAX, forceFirst, forcedOf, markedOf, nodeIdOf, resultRows } from './search-results';

const result = (recordId: string): ICockpitSearchResult => ({
  recordId,
  title: recordId,
  snippet: null,
  updatedAt: null,
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => `rec${i}`);

describe('search results on the chart (scope design §7.3)', () => {
  it('forces the first ten results, then the clicked ones to the front', () => {
    const forced = forcedOf(ids(14).map(result));
    expect(forced).toHaveLength(FORCED_MAX);
    expect(forced[0]).toBe('rec0');
    const after = forceFirst(forced, 'rec12');
    expect(after).toHaveLength(FORCED_MAX);
    expect(after[0]).toBe('rec12');
    expect(after).not.toContain('rec9');
    expect(forceFirst(after, 'rec3')).toEqual(['rec3', ...after.filter((x) => x !== 'rec3')]);
  });

  it('knows which results are on the chart, and marks only those', () => {
    const graph = finishGraph({
      title: 'T',
      nodes: [
        { id: 'hub:t', kind: 'hub', label: 'T', short: null, parent: null, tone: 'none' },
        {
          id: 'rec:a',
          kind: 'item',
          label: 'A',
          short: null,
          parent: 'hub:t',
          tone: 'route',
          recordId: 'a',
        },
      ],
      links: [],
    });
    const rows = resultRows([result('a'), result('b')], graph);
    expect(rows.map((r) => [r.recordId, r.onChart, r.tone])).toEqual([
      ['a', true, 'route'],
      ['b', false, undefined],
    ]);
    expect([...(markedOf([result('a'), result('b')], graph) ?? [])]).toEqual(['rec:a']);
    expect(markedOf([result('b')], graph)).toBeUndefined();
  });

  it('merges records the overview did not read, under their branch or their table hub', () => {
    const base: { nodes: IOverviewNode[] } = {
      nodes: [
        { id: 'hub:tbl1', kind: 'hub', label: 'T', short: null, parent: null, tone: 'none' },
        { id: 'rec:G', kind: 'hub', label: 'G', short: null, parent: null, tone: 'none' },
      ],
    };
    const extra: IOverviewNode[] = [
      { id: 'rec:G', kind: 'hub', label: 'G again', short: null, parent: null, tone: 'none' },
      { id: 'rec:x', kind: 'item', label: 'x', short: null, parent: 'rec:G', tone: 'ink' },
      {
        id: 'rec:y',
        kind: 'item',
        label: 'y',
        short: null,
        parent: 'rec:nowhere',
        tone: 'ink',
        tableId: 'tbl1',
      },
    ];
    const merged = mergeNodes(base, extra);
    expect(merged.nodes.map((n) => [n.id, n.parent, n.label])).toEqual([
      ['hub:tbl1', null, 'T'],
      ['rec:G', null, 'G'],
      ['rec:x', 'rec:G', 'x'],
      ['rec:y', 'hub:tbl1', 'y'],
    ]);
    expect(mergeNodes(base, [])).toBe(base);
  });

  it('draws the forced records whatever the budget, dropping the least relevant others', () => {
    const items: IGNode[] = ids(60).map((id, i) => ({
      id: nodeIdOf(id),
      kind: 'item',
      label: id,
      short: null,
      parent: 'hub:t',
      // the forced ones are the least relevant: ink, old
      tone: i >= 55 ? 'ink' : 'route',
      size: 0,
    }));
    const graph = finishGraph({
      title: 'T',
      nodes: [
        { id: 'hub:t', kind: 'hub', label: 'T', short: null, parent: null, tone: 'none' },
        ...items,
      ],
      links: [],
    });
    const must = new Set([nodeIdOf('rec58'), nodeIdOf('rec59')]);
    const plain = limitGraph(graph, { budget: 20 });
    expect(plain.graph.byId.has(nodeIdOf('rec59'))).toBe(false);
    const forced = limitGraph(graph, { budget: 20, must });
    expect(forced.graph.byId.has(nodeIdOf('rec58'))).toBe(true);
    expect(forced.graph.byId.has(nodeIdOf('rec59'))).toBe(true);
    expect(forced.shown).toBe(plain.shown);
  });
});
