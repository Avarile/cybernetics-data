/* eslint-disable @typescript-eslint/naming-convention */
import type { ISchemaPackView, SchemaPackId } from '@teable/openapi';

export interface IPackMapTable {
  pack: SchemaPackId;
  icon?: string;
  optional?: boolean;
  views?: ISchemaPackView[];
}

export interface IPackMapLinkFix {
  isOneWay: false;
  symmetric: { key: string; name: string };
}

export interface IPackMap {
  /** Tables to ship, in install order. Anything not listed is never shipped. */
  tables: Record<string, IPackMapTable>;
  /** Fields never shipped, by table name. */
  excludeFields: Record<string, string[]>;
  /** Select choices renamed on the way out, by table name then field name. */
  choiceRenames: Record<string, Record<string, Record<string, string>>>;
  /** Links rebuilt as a clean two-way pair, by table name then field name. */
  linkFixes: Record<string, Record<string, IPackMapLinkFix>>;
}

/**
 * How base `data-centre` (bseJEuE54y5caWO0Xc8) splits into packs.
 * See scripts/customized/developments/current-design.md §2.
 */
export const PACK_MAP: IPackMap = {
  tables: {
    goals: { pack: 'progress', icon: '🎯' },
    projects: {
      pack: 'progress',
      icon: '📁',
      views: [{ name: 'Board', type: 'kanban', stackField: 'progress' }],
    },
    tasks: {
      pack: 'progress',
      icon: '✅',
      views: [{ name: 'Board', type: 'kanban', stackField: 'progress' }],
    },
    project_frameworks: { pack: 'progress', icon: '🧭', optional: true },
    contacts: { pack: 'people', icon: '👤' },
    companies: { pack: 'people', icon: '🏢' },
    contact_type: { pack: 'people', icon: '🏷️' },
    contact_profession: { pack: 'people', icon: '💼' },
    auditlog: { pack: 'people', icon: '📝', optional: true },
    knowledges: { pack: 'knowledge', icon: '📚' },
    knowledge_type: { pack: 'knowledge', icon: '🗂️' },
    finance_Accounts: { pack: 'finance', icon: '🏦' },
    finance_Categories: { pack: 'finance', icon: '🗃️' },
    finance_Payees: { pack: 'finance', icon: '🧾' },
    finance_Tags: { pack: 'finance', icon: '🔖', optional: true },
    finance_Budgets: { pack: 'finance', icon: '📊', optional: true },
    finance_Transactions: { pack: 'finance', icon: '💸' },
  },
  // Plain-text secrets have no place in a starter schema.
  excludeFields: { knowledge_type: ['credentials'] },
  choiceRenames: { finance_Tags: { Color: { Organge: 'Orange' } } },
  // Source has a one-way parent_type plus a child_types whose symmetric field is missing.
  linkFixes: {
    knowledge_type: {
      parent_type: { isOneWay: false, symmetric: { key: 'child_types', name: 'child_types' } },
    },
  },
};
