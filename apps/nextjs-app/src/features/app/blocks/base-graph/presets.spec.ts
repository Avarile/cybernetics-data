import { resolveActiveQuery } from './hooks/useActiveQuery';
import { BUILT_IN_PRESETS, defaultPreset } from './presets';
import { link, SCHEMA, table } from './utils/fixtures';

const KNOWLEDGE_SCHEMA = {
  baseId: 'bseTest',
  tables: [
    table('tblType', 'knowledge_type', [link('fldParentType', 'tblType', 'tblType')]),
    table(
      'tblKn',
      'knowledges',
      [
        link('fldKnParent', 'tblKn', 'tblKn'),
        link('fldKnType', 'tblType', 'tblKn'),
        link('fldRelated', 'tblKn', 'tblKn', { isMultipleCellValue: true }),
      ].map((l) => ({
        ...l,
        name:
          l.id === 'fldKnParent'
            ? 'knowledge_parent'
            : l.id === 'fldKnType'
              ? 'knowledge_type'
              : 'related_knowledge',
      })),
      {
        fields: [
          { id: 'fldKnDeleted', name: 'deleted_at', type: 'date' as never, isComputed: false },
        ],
      }
    ),
  ].map((t) =>
    t.id === 'tblType'
      ? { ...t, linkFields: t.linkFields.map((l) => ({ ...l, name: 'parent_type' })) }
      : t
  ),
};

const knowledge = BUILT_IN_PRESETS.find((p) => p.id === 'knowledge')!;

describe('presets', () => {
  it('resolves the knowledge preset by name into ids', () => {
    const { ro, missing } = knowledge.build(KNOWLEDGE_SCHEMA);
    expect(missing).toEqual([]);
    expect(ro).toEqual({
      tables: [
        { tableId: 'tblType', hierarchyFieldId: 'fldParentType' },
        {
          tableId: 'tblKn',
          hierarchyFieldId: 'fldKnParent',
          groupByFieldId: 'fldKnType',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldKnDeleted', operator: 'isEmpty', value: null }],
          },
        },
      ],
      linkFieldIds: ['fldRelated'],
      showBaseHub: true,
    });
  });

  it('reports what is missing instead of building a broken query', () => {
    expect(knowledge.build(SCHEMA)).toEqual({
      ro: null,
      missing: ['table knowledge_type', 'table knowledges'],
    });
  });

  it('defaults to knowledge when possible, otherwise all non-system tables', () => {
    expect(defaultPreset(KNOWLEDGE_SCHEMA).id).toBe('knowledge');
    const all = defaultPreset(SCHEMA);
    expect(all.id).toBe('all');
    expect(all.build(SCHEMA).ro?.tables.map((t) => t.tableId)).toEqual([
      'tblProjects',
      'tblTasks',
      'tblTags',
    ]);
  });
});

describe('resolveActiveQuery', () => {
  const urlRo = { tables: [{ tableId: 'tblTags' }] };
  const saved = [{ id: 'saved-1', label: 'Mine', ro: { tables: [{ tableId: 'tblTasks' }] } }];

  it('prefers an explicit query, then a saved preset, then a built-in, then the default', () => {
    expect(resolveActiveQuery(SCHEMA, urlRo, 'knowledge', saved)).toEqual({
      ro: urlRo,
      presetId: null,
    });
    expect(resolveActiveQuery(SCHEMA, null, 'saved-1', saved).presetId).toBe('saved-1');
    expect(resolveActiveQuery(SCHEMA, null, 'people', saved).presetId).toBe('all');
    expect(resolveActiveQuery(SCHEMA, null, null, []).presetId).toBe('all');
    expect(resolveActiveQuery(undefined, null, null, []).ro).toBeNull();
  });
});
