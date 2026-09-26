import type { IBaseGraphQueryRo, IBaseGraphSchemaTable, IBaseGraphSchemaVo } from '@teable/openapi';

/**
 * Tables left out of "everything" by default: logs and plumbing that would
 * crowd out the data people actually navigate. A UI default only — the user can
 * still tick them.
 */
export const SYSTEM_TABLE_NAMES = new Set([
  'auditlog',
  'system_info',
  'system_status',
  'template_table',
  'table_references',
]);

export interface IResolvedPreset {
  ro: IBaseGraphQueryRo | null;
  /** Why the preset cannot be built for this base, e.g. a missing table. */
  missing: string[];
}

export interface IGraphPreset {
  id: string;
  label: string;
  build: (schema: IBaseGraphSchemaVo) => IResolvedPreset;
}

const byName = (schema: IBaseGraphSchemaVo, name: string) =>
  schema.tables.find((t) => t.name === name);
const linkByName = (table: IBaseGraphSchemaTable | undefined, name: string) =>
  table?.linkFields.find((l) => l.name === name && !l.isCrossBase)?.id;
const fieldByName = (table: IBaseGraphSchemaTable | undefined, name: string) =>
  table?.fields.find((f) => f.name === name)?.id;

/**
 * Resolves names to ids ONCE, here. The query then carries ids only, so a later
 * rename of a table or field no longer breaks a graph the user has open.
 */
const knowledgePreset: IGraphPreset = {
  id: 'knowledge',
  label: 'Knowledge',
  build: (schema) => {
    const types = byName(schema, 'knowledge_type');
    const knowledges = byName(schema, 'knowledges');
    const missing = [!types && 'table knowledge_type', !knowledges && 'table knowledges'].filter(
      (m): m is string => Boolean(m)
    );
    if (!types || !knowledges) return { ro: null, missing };

    const notDeleted = (table: IBaseGraphSchemaTable) => {
      const deletedAt = fieldByName(table, 'deleted_at');
      return deletedAt
        ? {
            filter: {
              conjunction: 'and' as const,
              filterSet: [{ fieldId: deletedAt, operator: 'isEmpty' as const, value: null }],
            },
          }
        : {};
    };
    const related = linkByName(knowledges, 'related_knowledge');
    return {
      missing: [],
      ro: {
        tables: [
          {
            tableId: types.id,
            hierarchyFieldId: linkByName(types, 'parent_type'),
            ...notDeleted(types),
          },
          {
            tableId: knowledges.id,
            hierarchyFieldId: linkByName(knowledges, 'knowledge_parent'),
            groupByFieldId: linkByName(knowledges, 'knowledge_type'),
            ...notDeleted(knowledges),
          },
        ],
        linkFieldIds: related ? [related] : [],
        showBaseHub: true,
      },
    };
  },
};

/** A preset over named tables, all links between them, table hubs on. */
const tablesPreset = (id: string, label: string, names: string[]): IGraphPreset => ({
  id,
  label,
  build: (schema) => {
    const tables = names.map((name) => byName(schema, name));
    const found = tables.filter((t): t is IBaseGraphSchemaTable => Boolean(t));
    if (!found.length) {
      return { ro: null, missing: names.map((n) => `table ${n}`) };
    }
    return {
      missing: [],
      ro: {
        tables: found.map((t) => ({ tableId: t.id })),
        showTableHubs: true,
        showBaseHub: true,
      },
    };
  },
});

const everythingPreset: IGraphPreset = {
  id: 'all',
  label: 'All tables',
  build: (schema) => {
    const tables = schema.tables.filter((t) => !SYSTEM_TABLE_NAMES.has(t.name));
    if (!tables.length) return { ro: null, missing: ['any non-system table'] };
    return {
      missing: [],
      ro: {
        tables: tables.map((t) => ({ tableId: t.id })),
        showTableHubs: true,
        showBaseHub: true,
      },
    };
  },
};

export const BUILT_IN_PRESETS: IGraphPreset[] = [
  knowledgePreset,
  tablesPreset('work', 'Goals & projects', ['goals', 'projects', 'tasks', 'project_frameworks']),
  tablesPreset('people', 'People', ['contacts', 'companies', 'contact_type', 'contact_profession']),
  tablesPreset('finance', 'Finance', [
    'finance_Transactions',
    'finance_Accounts',
    'finance_Payees',
    'finance_Categories',
    'finance_Tags',
    'finance_Budgets',
  ]),
  everythingPreset,
];

/** The knowledge preset when the base has it, otherwise everything. */
export const defaultPreset = (schema: IBaseGraphSchemaVo): IGraphPreset =>
  knowledgePreset.build(schema).ro ? knowledgePreset : everythingPreset;

export interface ISavedPreset {
  id: string;
  label: string;
  ro: IBaseGraphQueryRo;
}

const storageKey = (baseId: string) => `base-graph:presets:${baseId}`;

/** Browser storage can be absent or throw (private mode, blocked site data). */
export const loadSavedPresets = (baseId: string): ISavedPreset[] => {
  try {
    const raw = window.localStorage.getItem(storageKey(baseId));
    const parsed = raw ? (JSON.parse(raw) as ISavedPreset[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const storeSavedPresets = (baseId: string, presets: ISavedPreset[]): boolean => {
  try {
    window.localStorage.setItem(storageKey(baseId), JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
};
