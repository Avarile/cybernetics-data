/* eslint-disable @typescript-eslint/naming-convention */
import { FieldType } from '@teable/core';
import type { IBaseGraphQueryRo } from '@teable/openapi';
import type { IFieldInstance } from '../field/model/factory';
import type { IResolverInput } from './graph-plan.resolver';
import { resolveGraphPlan } from './graph-plan.resolver';

const BASE = 'bseTest';

const text = (id: string, isPrimary = false) =>
  ({
    id,
    name: id,
    type: FieldType.SingleLineText,
    isPrimary,
    options: {},
  }) as unknown as IFieldInstance;

const link = (
  id: string,
  foreignTableId: string,
  opts: { multi?: boolean; twin?: string; lookup?: boolean; baseId?: string } = {}
) =>
  ({
    id,
    name: id,
    type: FieldType.Link,
    isMultipleCellValue: Boolean(opts.multi),
    isLookup: opts.lookup,
    options: { foreignTableId, symmetricFieldId: opts.twin, baseId: opts.baseId },
  }) as unknown as IFieldInstance;

/**
 * tasks: parent (self, single) ↔ children (self, multi); project (→ projects,
 * single) ↔ projects.tasks; tags (→ tags, multi) ↔ tags.tasks.
 */
const FIELDS = new Map<string, IFieldInstance[]>([
  [
    'tblTasks',
    [
      text('fldTaskName', true),
      link('fldParent', 'tblTasks', { twin: 'fldChildren' }),
      link('fldChildren', 'tblTasks', { twin: 'fldParent', multi: true }),
      link('fldProject', 'tblProjects', { twin: 'fldProjTasks' }),
      link('fldTags', 'tblTags', { twin: 'fldTagTasks', multi: true }),
      link('fldProjectLookup', 'tblProjects', { lookup: true }),
      link('fldRemote', 'tblElsewhere', { baseId: 'bseOther' }),
    ],
  ],
  [
    'tblProjects',
    [
      text('fldProjName', true),
      link('fldProjTasks', 'tblTasks', { twin: 'fldProject', multi: true }),
    ],
  ],
  [
    'tblTags',
    [text('fldTagName', true), link('fldTagTasks', 'tblTasks', { twin: 'fldTags', multi: true })],
  ],
  ['tblNoPrimary', [text('fldX')]],
]);

const input = (ro: IBaseGraphQueryRo, overrides: Partial<IResolverInput> = {}): IResolverInput => ({
  baseId: BASE,
  ro,
  tables: [
    { id: 'tblTasks', name: 'tasks' },
    { id: 'tblProjects', name: 'projects' },
    { id: 'tblTags', name: 'tags' },
    { id: 'tblNoPrimary', name: 'broken' },
  ],
  fieldsByTable: FIELDS,
  viewIdsByTable: new Map([['tblTasks', new Set(['viwTasks'])]]),
  config: { maxNodes: 5000, maxLinks: 15000, defaultTableLimit: 1000, cacheTtlSeconds: 60 },
  labels: { base: 'My base', unclassified: 'Unclassified' },
  ...overrides,
});

const edgesOf = (plan: ReturnType<typeof resolveGraphPlan>) =>
  plan.tables.flatMap((t) => t.edgeFields.map((e) => `${t.tableId}.${e.fieldId}~${e.pairId}`));

describe('resolveGraphPlan', () => {
  it('404s a table outside the base', () => {
    expect(() => resolveGraphPlan(input({ tables: [{ tableId: 'tblForeign' }] }))).toThrow(
      /does not belong to base/
    );
  });

  it('404s a table with no primary field', () => {
    expect(() => resolveGraphPlan(input({ tables: [{ tableId: 'tblNoPrimary' }] }))).toThrow(
      /no primary field/
    );
  });

  it('rejects a view of another table', () => {
    expect(() =>
      resolveGraphPlan(input({ tables: [{ tableId: 'tblProjects', viewId: 'viwTasks' }] }))
    ).toThrow(/not a view of table/);
  });

  it('rejects a filter on unknown fields', () => {
    expect(() =>
      resolveGraphPlan(
        input({
          tables: [
            {
              tableId: 'tblTasks',
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: 'fldNope', operator: 'isEmpty', value: null }],
              },
            },
          ],
        })
      )
    ).toThrow(/unknown fields: fldNope/);
  });

  it('rejects a multi-valued hierarchy, and one that leaves the table', () => {
    expect(() =>
      resolveGraphPlan(
        input({ tables: [{ tableId: 'tblTasks', hierarchyFieldId: 'fldChildren' }] })
      )
    ).toThrow(/multi-valued/);
    expect(() =>
      resolveGraphPlan(input({ tables: [{ tableId: 'tblTasks', hierarchyFieldId: 'fldProject' }] }))
    ).toThrow(/link the table to itself/);
    expect(() =>
      resolveGraphPlan(
        input({ tables: [{ tableId: 'tblTasks', hierarchyFieldId: 'fldTaskName' }] })
      )
    ).toThrow(/must be a Link field/);
  });

  it('rejects a self-link or cross-base group, and a lookup posing as a link', () => {
    expect(() =>
      resolveGraphPlan(input({ tables: [{ tableId: 'tblTasks', groupByFieldId: 'fldParent' }] }))
    ).toThrow(/another table/);
    expect(() =>
      resolveGraphPlan(input({ tables: [{ tableId: 'tblTasks', groupByFieldId: 'fldRemote' }] }))
    ).toThrow(/another base/);
    expect(() =>
      resolveGraphPlan(
        input({ tables: [{ tableId: 'tblTasks', groupByFieldId: 'fldProjectLookup' }] })
      )
    ).toThrow(/must be a Link field/);
  });

  it('reads one side of each two-way pair when both tables are in', () => {
    const plan = resolveGraphPlan(
      input({
        tables: [{ tableId: 'tblTasks' }, { tableId: 'tblProjects' }, { tableId: 'tblTags' }],
      })
    );
    // fldChildren < fldParent, fldProjTasks < fldProject, fldTagTasks < fldTags.
    expect(edgesOf(plan).sort()).toEqual([
      'tblProjects.fldProjTasks~fldProjTasks',
      'tblTags.fldTagTasks~fldTagTasks',
      'tblTasks.fldChildren~fldChildren',
    ]);
  });

  it('reads the only side present when the other table is out', () => {
    const plan = resolveGraphPlan(
      input({ tables: [{ tableId: 'tblTasks' }, { tableId: 'tblTags' }] })
    );
    expect(edgesOf(plan)).toContain('tblTags.fldTagTasks~fldTagTasks');
    expect(edgesOf(plan).some((e) => e.includes('fldProject'))).toBe(false);
  });

  it('never draws the hierarchy or its twin as link edges, nor lookups or cross-base links', () => {
    const plan = resolveGraphPlan(
      input({ tables: [{ tableId: 'tblTasks', hierarchyFieldId: 'fldParent' }] })
    );
    expect(edgesOf(plan)).toEqual([]);
  });

  it('narrows to linkFieldIds, keeping the pair id stable', () => {
    const plan = resolveGraphPlan(
      input({
        tables: [{ tableId: 'tblTasks' }, { tableId: 'tblProjects' }],
        linkFieldIds: ['fldProject'],
      })
    );
    expect(edgesOf(plan)).toEqual(['tblTasks.fldProject~fldProjTasks']);
  });

  it('rejects linkFieldIds that cannot be drawn', () => {
    expect(() =>
      resolveGraphPlan(input({ tables: [{ tableId: 'tblTasks' }], linkFieldIds: ['fldProject'] }))
    ).toThrow(/not drawable/);
  });

  it('marks the group target only when that table is in the graph', () => {
    const inGraph = resolveGraphPlan(
      input({
        tables: [{ tableId: 'tblTasks', groupByFieldId: 'fldProject' }, { tableId: 'tblProjects' }],
      })
    );
    expect(inGraph.tables[0].groupTargetTableId).toBe('tblProjects');
    // The group's twin (projects.tasks) is structural, not an edge.
    expect(edgesOf(inGraph).some((e) => e.includes('fldProjTasks'))).toBe(false);

    const outOfGraph = resolveGraphPlan(
      input({ tables: [{ tableId: 'tblTasks', groupByFieldId: 'fldProject' }] })
    );
    expect(outOfGraph.tables[0].groupTargetTableId).toBeNull();
  });

  it('rejects group fields that form a cycle between tables', () => {
    const fields = new Map(FIELDS);
    fields.set('tblProjects', [text('fldProjName', true), link('fldProjLead', 'tblTasks')]);
    expect(() =>
      resolveGraphPlan(
        input(
          {
            tables: [
              { tableId: 'tblTasks', groupByFieldId: 'fldProject' },
              { tableId: 'tblProjects', groupByFieldId: 'fldProjLead' },
            ],
          },
          { fieldsByTable: fields }
        )
      )
    ).toThrow(/cycle/);
  });

  it('clamps client budgets to config', () => {
    const plan = resolveGraphPlan(
      input({ tables: [{ tableId: 'tblTasks', limit: 20000 }], maxNodes: 99999, maxLinks: 99999 })
    );
    expect(plan.assembler.maxNodes).toBe(5000);
    expect(plan.assembler.maxLinks).toBe(15000);
    expect(plan.tables[0].limit).toBe(5000);
    expect(resolveGraphPlan(input({ tables: [{ tableId: 'tblTags' }] })).tables[0].limit).toBe(
      1000
    );
  });

  it('marks a table probe-unsafe when a used or filtered field is computed', () => {
    const fields = new Map(FIELDS);
    fields.set('tblTags', [
      text('fldTagName', true),
      link('fldTagTasks', 'tblTasks', { twin: 'fldTags', multi: true }),
      { ...text('fldFormula'), isComputed: true } as unknown as IFieldInstance,
    ]);
    const plain = resolveGraphPlan(
      input({ tables: [{ tableId: 'tblTags' }] }, { fieldsByTable: fields })
    );
    expect(plain.tables[0].probeSafe).toBe(true);

    const filtered = resolveGraphPlan(
      input(
        {
          tables: [
            {
              tableId: 'tblTags',
              filter: {
                conjunction: 'and',
                filterSet: [{ fieldId: 'fldFormula', operator: 'isNotEmpty', value: null }],
              },
            },
          ],
        },
        { fieldsByTable: fields }
      )
    );
    expect(filtered.tables[0].probeSafe).toBe(false);

    const viaView = resolveGraphPlan(
      input(
        { tables: [{ tableId: 'tblTags', viewId: 'viwTags' }] },
        {
          fieldsByTable: fields,
          viewIdsByTable: new Map([['tblTags', new Set(['viwTags'])]]),
          viewFilterFieldIds: new Map([['viwTags', ['fldFormula']]]),
        }
      )
    );
    expect(viaView.tables[0].probeSafe).toBe(false);
  });
});
