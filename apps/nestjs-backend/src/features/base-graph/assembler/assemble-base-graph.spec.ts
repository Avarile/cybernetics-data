/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import { assembleBaseGraph } from './assemble-base-graph';
import { applyBudget } from './budget';
import { orderTablesByGroupDependency } from './structure';
import type { IAssemblerPlan, IAssemblerTable, IGraphRow, ITableRows } from './types';

const table = (tableId: string, overrides: Partial<IAssemblerTable> = {}): IAssemblerTable => ({
  tableId,
  name: tableId,
  hierarchyFieldId: null,
  groupFieldId: null,
  groupTargetTableId: null,
  edgeFields: [],
  ...overrides,
});

const plan = (
  tables: IAssemblerTable[],
  overrides: Partial<IAssemblerPlan> = {}
): IAssemblerPlan => ({
  tables,
  maxNodes: 1000,
  maxLinks: 1000,
  showTableHubs: false,
  showBaseHub: false,
  baseLabel: 'base',
  unclassifiedLabel: 'Unclassified',
  ...overrides,
});

const row = (
  recordId: string,
  title: string,
  extra: Partial<Omit<IGraphRow, 'recordId' | 'title'>> = {}
): IGraphRow => ({ recordId, title, parentRecordId: null, group: null, links: [], ...extra });

const rows = (entries: Record<string, IGraphRow[]>, truncated: string[] = []) =>
  new Map<string, ITableRows>(
    Object.entries(entries).map(([id, r]) => [id, { rows: r, truncated: truncated.includes(id) }])
  );

const node = (graph: ReturnType<typeof assembleBaseGraph>, id: string) => {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};

describe('assembleBaseGraph — cross-table links', () => {
  // goals ← projects ← tasks, all through ManyOne links; the symmetric OneMany
  // sides are the other field of each pair and are not read.
  const P = plan([
    table('tblGoals'),
    table('tblProjects', { edgeFields: [{ fieldId: 'fldProjGoal', pairId: 'fldGoalProjs' }] }),
    table('tblTasks', { edgeFields: [{ fieldId: 'fldTaskProj', pairId: 'fldProjTasks' }] }),
  ]);
  const data = rows({
    tblGoals: [row('recG1', 'Grow')],
    tblProjects: [
      row('recP1', 'Launch', { links: [{ fieldId: 'fldProjGoal', targetRecordIds: ['recG1'] }] }),
    ],
    tblTasks: [
      row('recT1', 'Write', { links: [{ fieldId: 'fldTaskProj', targetRecordIds: ['recP1'] }] }),
      row('recT2', 'Ship', { links: [{ fieldId: 'fldTaskProj', targetRecordIds: ['recP1'] }] }),
    ],
  });

  it('draws one link edge per linked pair, tagged with the read field', () => {
    const graph = assembleBaseGraph(P, data);
    expect(graph.links).toEqual([
      { source: 'rec:recG1', target: 'rec:recP1', kind: 'link', fieldId: 'fldProjGoal' },
      { source: 'rec:recP1', target: 'rec:recT1', kind: 'link', fieldId: 'fldTaskProj' },
      { source: 'rec:recP1', target: 'rec:recT2', kind: 'link', fieldId: 'fldTaskProj' },
    ]);
  });

  it('sizes by link degree and colours a flat table as one family', () => {
    const graph = assembleBaseGraph(P, data);
    expect(node(graph, 'rec:recP1').degree).toBe(3);
    expect(node(graph, 'rec:recT1')).toMatchObject({
      tableId: 'tblTasks',
      kind: 'record',
      parentId: null,
      depth: 0,
      colorKey: 'tbl:tblTasks',
    });
  });

  it('counts links to records outside the emitted set as dangling', () => {
    const graph = assembleBaseGraph(
      plan([P.tables[2]]),
      rows({ tblTasks: data.get('tblTasks')!.rows })
    );
    expect(graph.links).toEqual([]);
    expect(graph.stats.danglingLinks).toBe(2);
  });

  it('dedupes a two-way pair read from both ends into one edge', () => {
    const graph = assembleBaseGraph(
      plan([
        table('tblA', { edgeFields: [{ fieldId: 'fldAB', pairId: 'fldAB' }] }),
        table('tblB', { edgeFields: [{ fieldId: 'fldBA', pairId: 'fldAB' }] }),
      ]),
      rows({
        tblA: [row('recA', 'a', { links: [{ fieldId: 'fldAB', targetRecordIds: ['recB'] }] })],
        tblB: [row('recB', 'b', { links: [{ fieldId: 'fldBA', targetRecordIds: ['recA'] }] })],
      })
    );
    expect(graph.links).toHaveLength(1);
    expect(node(graph, 'rec:recA').degree).toBe(1);
  });

  it('keeps two different link fields between the same records as two edges', () => {
    const graph = assembleBaseGraph(
      plan([
        table('tblA', {
          edgeFields: [
            { fieldId: 'fldOwner', pairId: 'fldOwner' },
            { fieldId: 'fldReviewer', pairId: 'fldReviewer' },
          ],
        }),
        table('tblB'),
      ]),
      rows({
        tblA: [
          row('recA', 'a', {
            links: [
              { fieldId: 'fldOwner', targetRecordIds: ['recB'] },
              { fieldId: 'fldReviewer', targetRecordIds: ['recB'] },
            ],
          }),
        ],
        tblB: [row('recB', 'b')],
      })
    );
    expect(graph.links.map((l) => l.fieldId)).toEqual(['fldOwner', 'fldReviewer']);
  });

  it('ignores cells of fields that are not edge fields', () => {
    const graph = assembleBaseGraph(
      plan([table('tblA'), table('tblB')]),
      rows({
        tblA: [row('recA', 'a', { links: [{ fieldId: 'fldX', targetRecordIds: ['recB'] }] })],
        tblB: [row('recB', 'b')],
      })
    );
    expect(graph.links).toEqual([]);
    expect(graph.stats.danglingLinks).toBe(0);
  });
});

describe('assembleBaseGraph — structure', () => {
  it('hangs root records off their table hub, and hubs off the base', () => {
    const graph = assembleBaseGraph(
      plan([table('tblA', { name: 'Alpha' })], { showTableHubs: true, showBaseHub: true }),
      rows({ tblA: [row('recA', 'a')] })
    );
    expect(graph.nodes.map((n) => [n.id, n.kind, n.parentId])).toEqual([
      ['base', 'base', null],
      ['tbl:tblA', 'table', 'base'],
      ['rec:recA', 'record', 'tbl:tblA'],
    ]);
    expect(node(graph, 'tbl:tblA').label).toBe('Alpha');
    expect(graph.links.every((l) => l.kind === 'hub')).toBe(true);
  });

  it('groups by a table that is not in the graph with labelled synthetic nodes', () => {
    const graph = assembleBaseGraph(
      plan([table('tblTasks', { groupFieldId: 'fldProject' })]),
      rows({
        tblTasks: [
          row('recT1', 'one', { group: { recordId: 'recP1', title: 'Launch' } }),
          row('recT2', 'two', { group: { recordId: 'recP1', title: 'Launch' } }),
          row('recT3', 'three'),
        ],
      })
    );
    expect(node(graph, 'grp:fldProject:recP1')).toMatchObject({
      kind: 'group',
      label: 'Launch',
      tableId: 'tblTasks',
    });
    expect(node(graph, 'grp:fldProject:__none__').label).toBe('Unclassified');
    expect(node(graph, 'rec:recT1')).toMatchObject({
      parentId: 'grp:fldProject:recP1',
      depth: 1,
      colorKey: 'grp:fldProject:recP1',
    });
    expect(graph.stats.groupOrphans).toBe(1);
    // Groups precede the records under them; the none bucket is the last group.
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'grp:fldProject:recP1',
      'grp:fldProject:__none__',
      'rec:recT1',
      'rec:recT3',
      'rec:recT2',
    ]);
  });

  it('groups by an included table onto its record nodes, emitting the target first', () => {
    const graph = assembleBaseGraph(
      plan([
        table('tblTasks', { groupFieldId: 'fldProject', groupTargetTableId: 'tblProjects' }),
        table('tblProjects'),
      ]),
      rows({
        tblTasks: [row('recT1', 'one', { group: { recordId: 'recP1', title: 'Launch' } })],
        tblProjects: [row('recP1', 'Launch')],
      })
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(['rec:recP1', 'rec:recT1']);
    expect(node(graph, 'rec:recT1')).toMatchObject({
      parentId: 'rec:recP1',
      colorKey: 'rec:recP1',
    });
    // The group target table is drawn as a tree too, so it colours by itself.
    expect(node(graph, 'rec:recP1').colorKey).toBe('rec:recP1');
    expect(graph.links).toEqual([
      { source: 'rec:recP1', target: 'rec:recT1', kind: 'group', fieldId: 'fldProject' },
    ]);
  });

  it('draws a hierarchy and cuts its cycles', () => {
    const graph = assembleBaseGraph(
      plan([table('tblTasks', { hierarchyFieldId: 'fldParent' })]),
      rows({
        tblTasks: [
          row('recA', 'a', { parentRecordId: 'recB' }),
          row('recB', 'b', { parentRecordId: 'recA' }),
          row('recC', 'c', { parentRecordId: 'recA' }),
        ],
      })
    );
    expect(graph.stats.cyclesDropped).toBe(1);
    const hierarchy = graph.links.filter((l) => l.kind === 'hierarchy');
    expect(hierarchy.every((l) => l.fieldId === 'fldParent')).toBe(true);
    // Every node has at most one parent, and depth follows it.
    const roots = graph.nodes.filter((n) => n.parentId === null);
    expect(roots).toHaveLength(1);
    expect(Math.max(...graph.nodes.map((n) => n.depth))).toBeGreaterThanOrEqual(1);
  });

  it('ignores the hierarchy cell when no hierarchy field is configured', () => {
    const graph = assembleBaseGraph(
      plan([table('tblA')]),
      rows({ tblA: [row('recA', 'a'), row('recB', 'b', { parentRecordId: 'recA' })] })
    );
    expect(graph.nodes.every((n) => n.parentId === null)).toBe(true);
  });

  it('orders tables so group targets come first, keeping plan order otherwise', () => {
    const ordered = orderTablesByGroupDependency([
      table('tblC', { groupTargetTableId: 'tblB' }),
      table('tblA'),
      table('tblB', { groupTargetTableId: 'tblA' }),
    ]);
    expect(ordered.map((t) => t.tableId)).toEqual(['tblA', 'tblB', 'tblC']);
  });

  it('terminates on a group cycle the resolver should have rejected', () => {
    const ordered = orderTablesByGroupDependency([
      table('tblA', { groupTargetTableId: 'tblB' }),
      table('tblB', { groupTargetTableId: 'tblA' }),
    ]);
    expect(ordered).toHaveLength(2);
  });
});

describe('budgets', () => {
  const many = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      row(`rec${prefix}${String(i).padStart(3, '0')}`, `${prefix}${i}`)
    );

  it('leaves tables alone under budget', () => {
    const out = applyBudget({ tables: [table('tblA')], maxNodes: 5 }, rows({ tblA: many('A', 5) }));
    expect(out.get('tblA')).toMatchObject({ truncated: false });
    expect(out.get('tblA')!.rows).toHaveLength(5);
  });

  it('splits proportionally and hands leftovers out in plan order', () => {
    const out = applyBudget(
      { tables: [table('tblA'), table('tblB'), table('tblC')], maxNodes: 10 },
      rows({ tblA: many('A', 10), tblB: many('B', 10), tblC: many('C', 10) })
    );
    expect(['tblA', 'tblB', 'tblC'].map((id) => out.get(id)!.rows.length)).toEqual([4, 3, 3]);
    expect(out.get('tblC')!.truncated).toBe(true);
  });

  it('keeps the reader truncation flag', () => {
    const out = applyBudget(
      { tables: [table('tblA')], maxNodes: 100 },
      rows({ tblA: many('A', 2) }, ['tblA'])
    );
    expect(out.get('tblA')!.truncated).toBe(true);
  });

  it('is deterministic under shuffled input', () => {
    const base = many('A', 30);
    const shuffled = [...base].reverse();
    const P = { tables: [table('tblA')], maxNodes: 7 };
    expect(applyBudget(P, rows({ tblA: shuffled })).get('tblA')!.rows).toEqual(
      applyBudget(P, rows({ tblA: base })).get('tblA')!.rows
    );
  });

  it('never drops structural links for the link budget, and reports link truncation', () => {
    const graph = assembleBaseGraph(
      plan(
        [
          table('tblA', {
            hierarchyFieldId: 'fldParent',
            edgeFields: [{ fieldId: 'fldRel', pairId: 'fldRel' }],
          }),
        ],
        { maxLinks: 1 }
      ),
      rows({
        tblA: [
          row('recA', 'a', { links: [{ fieldId: 'fldRel', targetRecordIds: ['recC'] }] }),
          row('recB', 'b', { parentRecordId: 'recA' }),
          row('recC', 'c', { parentRecordId: 'recA' }),
        ],
      })
    );
    expect(graph.links.filter((l) => l.kind === 'hierarchy')).toHaveLength(2);
    expect(graph.links.filter((l) => l.kind === 'link')).toHaveLength(0);
    expect(graph.stats.truncated.links).toBe(true);
    // Degree still counts the hidden link.
    expect(node(graph, 'rec:recC').degree).toBe(2);
  });

  it('reports per-table stats', () => {
    const graph = assembleBaseGraph(
      plan([table('tblA'), table('tblB')], { maxNodes: 3 }),
      rows({ tblA: many('A', 4), tblB: many('B', 2) })
    );
    expect(graph.stats.perTable).toEqual([
      { tableId: 'tblA', emitted: 2, truncated: true },
      { tableId: 'tblB', emitted: 1, truncated: true },
    ]);
    expect(graph.stats.truncated.nodes).toBe(true);
  });
});
