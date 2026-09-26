/* eslint-disable @typescript-eslint/naming-convention */
import { assembleBaseGraph } from './assemble-base-graph';
import type { IAssemblerPlan, IGraphRow, ITableRows } from './types';

/**
 * Regression lock for the knowledge view. These snapshots were generated while
 * parity.spec — the new engine against the retired v3 knowledge assembler, over
 * these fixtures and a 300-case fuzz — still held, so they record the v3
 * behaviour. A diff here means the knowledge preset renders differently.
 */

interface IKnowledgeRow {
  recordId: string;
  title: string;
  typeRecordId: string | null;
  parentRecordId: string | null;
  relatedRecordIds: string[];
}
interface IKnowledgeTypeRow {
  recordId: string;
  title: string;
  parentRecordId: string | null;
}

const TYPE_TABLE = 'tblType';
const KN_TABLE = 'tblKnowledge';
const FLD_PARENT_TYPE = 'fldParentType';
const FLD_KN_PARENT = 'fldKnParent';
const FLD_KN_TYPE = 'fldKnType';
const FLD_RELATED = 'fldRelated';

const PLAN: IAssemblerPlan = {
  tables: [
    {
      tableId: TYPE_TABLE,
      name: 'knowledge_type',
      hierarchyFieldId: FLD_PARENT_TYPE,
      groupFieldId: null,
      groupTargetTableId: null,
      edgeFields: [],
    },
    {
      tableId: KN_TABLE,
      name: 'knowledges',
      hierarchyFieldId: FLD_KN_PARENT,
      groupFieldId: FLD_KN_TYPE,
      groupTargetTableId: TYPE_TABLE,
      edgeFields: [{ fieldId: FLD_RELATED, pairId: FLD_RELATED }],
    },
  ],
  maxNodes: 100000,
  maxLinks: 100000,
  showTableHubs: false,
  showBaseHub: true,
  baseLabel: 'knowledge_core',
  unclassifiedLabel: 'Unclassified',
};

const toRows = (types: IKnowledgeTypeRow[], knowledges: IKnowledgeRow[]) =>
  new Map<string, ITableRows>([
    [
      TYPE_TABLE,
      {
        truncated: false,
        rows: types.map<IGraphRow>((t) => ({ ...t, group: null, links: [] })),
      },
    ],
    [
      KN_TABLE,
      {
        truncated: false,
        rows: knowledges.map<IGraphRow>((k) => ({
          recordId: k.recordId,
          title: k.title,
          parentRecordId: k.parentRecordId,
          group: k.typeRecordId ? { recordId: k.typeRecordId, title: '' } : null,
          links: [{ fieldId: FLD_RELATED, targetRecordIds: k.relatedRecordIds }],
        })),
      },
    ],
  ]);

const type = (recordId: string, title: string, parentRecordId: string | null = null) => ({
  recordId,
  title,
  parentRecordId,
});
const kn = (
  recordId: string,
  title: string,
  typeRecordId: string | null,
  parentRecordId: string | null = null,
  relatedRecordIds: string[] = []
): IKnowledgeRow => ({ recordId, title, typeRecordId, parentRecordId, relatedRecordIds });

const expectSnapshot = (types: IKnowledgeTypeRow[], knowledges: IKnowledgeRow[]) =>
  expect(assembleBaseGraph(PLAN, toRows(types, knowledges))).toMatchSnapshot();

describe('knowledge preset (v3 behaviour, locked)', () => {
  it('empty tables', () => expectSnapshot([], []));

  it('flat taxonomy with classified and unclassified knowledge', () =>
    expectSnapshot(
      [type('t1', 'Alpha'), type('t2', 'Beta')],
      [
        kn('k1', 'One', 't1'),
        kn('k2', 'Two', 't2'),
        kn('k3', 'Three', null),
        kn('k4', 'Four', 'tGone'),
      ]
    ));

  it('nested types with an empty branch', () =>
    expectSnapshot(
      [
        type('t1', 'Root'),
        type('t2', 'Child', 't1'),
        type('t3', 'Grandchild', 't2'),
        type('t4', 'Empty'),
      ],
      [kn('k1', 'Leaf', 't3'), kn('k2', 'Mid', 't2')]
    ));

  it('type cycles and self-parents', () =>
    expectSnapshot(
      [type('t1', 'A', 't2'), type('t2', 'B', 't1'), type('t3', 'C', 't3')],
      [kn('k1', 'x', 't1'), kn('k2', 'y', 't3')]
    ));

  it('nested knowledge, including across types and under an unclassified root', () =>
    expectSnapshot(
      [type('t1', 'Root'), type('t2', 'Other')],
      [
        kn('k1', 'Parent', 't1'),
        kn('k2', 'Child', 't2', 'k1'),
        kn('k3', 'Grandchild', null, 'k2'),
        kn('k4', 'Orphan root', null),
        kn('k5', 'Under orphan', 't1', 'k4'),
      ]
    ));

  it('knowledge cycles and a parent that does not exist', () =>
    expectSnapshot(
      [type('t1', 'Root')],
      [kn('k1', 'a', 't1', 'k2'), kn('k2', 'b', 't1', 'k1'), kn('k3', 'c', 't1', 'kMissing')]
    ));

  it('relations: two-way duplicates, self-relations, dangling targets', () =>
    expectSnapshot(
      [type('t1', 'Root')],
      [
        kn('k1', 'a', 't1', null, ['k2', 'k1', 'kGone']),
        kn('k2', 'b', 't1', null, ['k1', 'k3']),
        kn('k3', 'c', 't1', 'k1', ['k2']),
      ]
    ));
});
