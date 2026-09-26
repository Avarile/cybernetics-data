/* eslint-disable sonarjs/no-duplicate-string */
import type { IBaseGraphLink, IBaseGraphNode } from '@teable/openapi';
import {
  buildSimulationGraph,
  hiddenClosure,
  isLinkVisible,
  isNodeVisible,
  mergeExpansions,
} from './buildSimulationGraph';
import { chargeFor, colorForNode, linkDistanceFor, nodeValFor } from './graphTheme';
import { VisualLinkTierValues, VisualNodeTierValues } from './visualTier';

const node = (id: string, extra: Partial<IBaseGraphNode> = {}): IBaseGraphNode => ({
  id,
  kind: 'record',
  tableId: 'tblKn',
  recordId: id.replace('rec:', ''),
  label: id,
  parentId: null,
  colorKey: null,
  depth: 0,
  degree: 1,
  ...extra,
});
const link = (
  source: string,
  target: string,
  kind: IBaseGraphLink['kind'],
  fieldId: string | null = null
): IBaseGraphLink => ({ source, target, kind, fieldId });

/** The knowledge preset's shape: base → type → knowledge → nested knowledge, plus a relation. */
const GRAPH = {
  nodes: [
    node('base', { kind: 'base', tableId: null, recordId: null }),
    node('rec:t1', { tableId: 'tblType', parentId: 'base' }),
    node('rec:t2', { tableId: 'tblType', parentId: 'rec:t1', depth: 1 }),
    node('grp:fldType:__none__', { kind: 'group', recordId: null, parentId: 'base' }),
    node('rec:k1', { parentId: 'rec:t2', depth: 2 }),
    node('rec:k2', { parentId: 'rec:k1', depth: 3 }),
    node('rec:k3', { parentId: 'grp:fldType:__none__', depth: 1 }),
  ],
  links: [
    link('base', 'rec:t1', 'hub'),
    link('rec:t1', 'rec:t2', 'hierarchy', 'fldParentType'),
    link('base', 'grp:fldType:__none__', 'hub'),
    link('rec:t2', 'rec:k1', 'group', 'fldType'),
    link('rec:k1', 'rec:k2', 'hierarchy', 'fldKnParent'),
    link('grp:fldType:__none__', 'rec:k3', 'group', 'fldType'),
    link('rec:k2', 'rec:k3', 'link', 'fldRelated'),
  ],
};
const NONE = { hiddenNodeIds: [], hiddenTableIds: [] };

describe('visual tiers', () => {
  it('reproduces the knowledge graph tiers under the knowledge preset', () => {
    const g = buildSimulationGraph(GRAPH, NONE);
    const tier = Object.fromEntries(g.nodes.map((n) => [n.id, n.tier]));
    expect(tier).toEqual({
      base: 'core',
      'rec:t1': 'type',
      'rec:t2': 'type',
      'grp:fldType:__none__': 'type',
      'rec:k1': 'knowledge',
      'rec:k2': 'knowledge',
      'rec:k3': 'knowledge',
    });
    expect(g.links.map((l) => l.tier)).toEqual([
      'core-type',
      'type-parent',
      'core-type',
      'type-knowledge',
      'knowledge-parent',
      'type-knowledge',
      'knowledge-knowledge',
    ]);
  });

  it('maps table hubs to types and their records to knowledges', () => {
    const g = buildSimulationGraph(
      {
        nodes: [
          node('base', { kind: 'base', tableId: null, recordId: null }),
          node('tbl:tblA', { kind: 'table', tableId: 'tblA', recordId: null, parentId: 'base' }),
          node('rec:a', { tableId: 'tblA', parentId: 'tbl:tblA' }),
        ],
        links: [link('base', 'tbl:tblA', 'hub'), link('tbl:tblA', 'rec:a', 'hub')],
      },
      NONE
    );
    expect(g.nodes.map((n) => n.tier)).toEqual(['core', 'type', 'knowledge']);
    expect(g.links.map((l) => l.tier)).toEqual(['core-type', 'type-knowledge']);
  });

  it('keeps every theme lookup total over the tiers', () => {
    for (const tier of VisualNodeTierValues) {
      expect(Number.isFinite(nodeValFor(tier, 3))).toBe(true);
      expect(Number.isFinite(chargeFor(tier))).toBe(true);
    }
    for (const tier of VisualLinkTierValues) {
      expect(Number.isFinite(linkDistanceFor(tier))).toBe(true);
    }
  });

  it('greys the none bucket and hues everything else by colour key', () => {
    expect(colorForNode({ tier: 'type', colorKey: 'grp:fldType:__none__', depth: 0 })).toBe(
      '#6b7280'
    );
    const a = colorForNode({ tier: 'type', colorKey: 'rec:t1', depth: 0 });
    const b = colorForNode({ tier: 'knowledge', colorKey: 'rec:t1', depth: 1 });
    expect(a.split(' ')[0]).toBe(b.split(' ')[0]);
  });
});

describe('hiding', () => {
  it('hides a clicked node with its whole structural subtree, across tables', () => {
    const closure = hiddenClosure(GRAPH.nodes, { hiddenNodeIds: ['rec:t1'], hiddenTableIds: [] });
    expect([...closure].sort()).toEqual(['rec:k1', 'rec:k2', 'rec:t1', 'rec:t2']);
  });

  it('hides a table, cascading to records nested under its records', () => {
    const closure = hiddenClosure(GRAPH.nodes, { hiddenNodeIds: [], hiddenTableIds: ['tblType'] });
    expect(closure.has('rec:k2')).toBe(true);
    expect(closure.has('rec:k3')).toBe(false);
  });

  it('never hides the base, and drops links with a hidden endpoint', () => {
    const g = buildSimulationGraph(GRAPH, { hiddenNodeIds: ['rec:t1'], hiddenTableIds: [] });
    expect(g.nodes.map((n) => n.id)).toEqual(['base', 'grp:fldType:__none__', 'rec:k3']);
    expect(g.links.every((l) => l.source !== 'rec:k2' && l.target !== 'rec:k2')).toBe(true);
  });

  it('draws neither the base nor its tether', () => {
    const g = buildSimulationGraph(GRAPH, NONE);
    expect(g.nodes.filter(isNodeVisible)).toHaveLength(6);
    expect(g.links.filter(isLinkVisible)).toHaveLength(5);
  });

  it('clones, so the renderer cannot corrupt the cached payload', () => {
    const g = buildSimulationGraph(GRAPH, NONE);
    (g.nodes[1] as { x?: number }).x = 42;
    expect((GRAPH.nodes[1] as { x?: number }).x).toBeUndefined();
  });
});

describe('expansions', () => {
  it('adds new nodes, keeps the server copy of known ones, and one edge per pair', () => {
    const merged = mergeExpansions(GRAPH, [
      {
        nodes: [node('rec:k1', { label: 'dup' }), node('rec:x', { tableId: 'tblOther' })],
        links: [link('rec:k1', 'rec:x', 'link', 'fldX'), link('rec:k3', 'rec:k2', 'link', 'fldY')],
        truncated: false,
      },
    ]);
    expect(merged.nodes.find((n) => n.id === 'rec:k1')?.label).toBe('rec:k1');
    expect(merged.nodes.map((n) => n.id)).toContain('rec:x');
    // k2–k3 is already joined by fldRelated, so the expansion's edge is dropped.
    expect(
      merged.links.filter((l) => [l.source, l.target].sort().join() === 'rec:k2,rec:k3')
    ).toHaveLength(1);
    expect(merged.links.some((l) => l.target === 'rec:x')).toBe(true);
  });
});
