import type { IOverviewDatasetId } from '@teable/openapi';
import type { ISearchTone } from '../search/search.types';

/** branch: a labelled hub; item: a dot on the rim; actor: a diamond on its table's hub. */
export type IOverviewRole = 'branch' | 'item' | 'actor';

/**
 * One table of a dataset (overview design §5.1), by names resolved against the live schema, as
 * the ai-cockpit's presets are: the dataset survives renames of fields it does not name.
 */
export interface IOverviewTable {
  name: string;
  role: IOverviewRole;
  /** A single-valued self-link: the table draws as a tree. */
  hierarchy?: string;
  /** A single-valued link to another table of the dataset: root records hang under that record. */
  groupBy?: string;
  /** A status-like select, or `fresh` (tone from how recently the record changed). */
  tone?: string;
  /** Select value (lower case) → tone, instead of the shared state words. */
  toneMap?: Record<string, ISearchTone>;
  /** A priority select or an amount: the dot's size. */
  size?: string;
  /** An amount carried on the node and summed by the readout. */
  money?: string;
  /** The first of these that has a value is the record's date. */
  date?: string[];
  /** Halo when the date passed and the record is not settled. */
  dueAlert?: boolean;
  /** Settled once it has children and every one of them is settled (goals have no status). */
  settledByChildren?: boolean;
  /** Only records whose state is not settled or cancelled. */
  open?: boolean;
  /** Only records dated within this many days. */
  windowDays?: number;
  /** Drawn only when an edge links it to a record of a table that is not pruned. */
  prune?: boolean;
  /** A branch drawn even with nothing under it (the people of PEOPLE). */
  keepEmpty?: boolean;
  /**
   * Label of the hub holding the table's records that have no parent (and every actor). Null:
   * those records are counted, not drawn.
   */
  orphan: string | null;
  /** Key shown before a record's label. */
  short: string;
}

export interface IOverviewDataset {
  id: IOverviewDatasetId;
  title: string;
  path: string;
  tables: IOverviewTable[];
  /** Link fields drawn as edges, by name, on any table of the dataset. */
  edges: string[];
}

const recent = ['updated_at', 'created_at'];

/** The four datasets of the overview (design §5.2), in the order the cockpit shows them. */
export const OVERVIEW_DATASETS: IOverviewDataset[] = [
  {
    id: 'work',
    title: 'WORK',
    path: 'GOAL → PROJECT → TASK · EDGES = PEOPLE, REFERENCES',
    tables: [
      {
        name: 'goals',
        role: 'branch',
        date: ['deadline'],
        dueAlert: true,
        settledByChildren: true,
        orphan: null,
        short: 'GOAL',
      },
      {
        name: 'projects',
        role: 'item',
        groupBy: 'belong_goals',
        tone: 'progress',
        date: recent,
        orphan: 'PROJECTS · NO GOAL',
        short: 'PROJECT',
      },
      {
        name: 'tasks',
        role: 'item',
        groupBy: 'belong_project',
        tone: 'progress',
        size: 'priority',
        date: ['finished_at', 'started_at', ...recent],
        orphan: 'TASKS · NO PROJECT',
        short: 'TASK',
      },
      { name: 'contacts', role: 'actor', prune: true, orphan: 'PEOPLE', short: 'PERSON' },
      {
        name: 'knowledges',
        role: 'item',
        tone: 'fresh',
        date: recent,
        prune: true,
        orphan: 'REFERENCES',
        short: 'NOTE',
      },
    ],
    edges: ['assigned_to', 'lead_by', 'refer_knowledge'],
  },
  {
    id: 'knowledge',
    title: 'KNOWLEDGE',
    path: 'TYPE → ENTRY → SUB-ENTRY · EDGES = RELATED',
    tables: [
      {
        name: 'knowledge_type',
        role: 'branch',
        hierarchy: 'parent_type',
        orphan: null,
        short: 'TYPE',
      },
      {
        name: 'knowledges',
        role: 'item',
        hierarchy: 'knowledge_parent',
        groupBy: 'knowledge_type',
        tone: 'fresh',
        date: recent,
        orphan: 'UNTYPED',
        short: 'NOTE',
      },
    ],
    edges: ['related_knowledge'],
  },
  {
    id: 'people',
    title: 'PEOPLE',
    path: 'TYPE → PERSON → THEIR OPEN WORK · EDGES = PROFESSION, COMPANY',
    tables: [
      { name: 'contact_type', role: 'branch', orphan: null, short: 'TYPE' },
      {
        name: 'contacts',
        role: 'branch',
        groupBy: 'contact_type',
        keepEmpty: true,
        orphan: 'NO TYPE',
        short: 'PERSON',
      },
      {
        name: 'projects',
        role: 'item',
        groupBy: 'lead_by',
        tone: 'progress',
        open: true,
        date: recent,
        orphan: null,
        short: 'PROJECT',
      },
      {
        name: 'tasks',
        role: 'item',
        groupBy: 'assigned_to',
        tone: 'progress',
        size: 'priority',
        open: true,
        date: ['started_at', ...recent],
        orphan: null,
        short: 'TASK',
      },
      {
        name: 'contact_profession',
        role: 'actor',
        prune: true,
        orphan: 'PROFESSIONS',
        short: 'PROFESSION',
      },
      { name: 'companies', role: 'actor', prune: true, orphan: 'COMPANIES', short: 'COMPANY' },
    ],
    edges: ['contact_profession', 'contact_company', 'belong_project'],
  },
  {
    id: 'finance',
    title: 'FINANCE',
    path: 'CATEGORY → TRANSACTION · LAST 90 DAYS · EDGES = PAYEE, ACCOUNT',
    tables: [
      {
        name: 'finance_Categories',
        role: 'branch',
        hierarchy: 'Parent Category',
        orphan: null,
        short: 'CATEGORY',
      },
      {
        name: 'finance_Transactions',
        role: 'item',
        groupBy: 'Category',
        tone: 'Type',
        toneMap: { expense: 'route', income: 'target', transfer: 'dim' },
        size: 'Amount',
        money: 'Amount',
        date: ['Date'],
        windowDays: 90,
        orphan: 'UNCATEGORISED',
        short: 'TXN',
      },
      { name: 'finance_Payees', role: 'actor', prune: true, orphan: 'PAYEES', short: 'PAYEE' },
      {
        name: 'finance_Accounts',
        role: 'actor',
        prune: true,
        orphan: 'ACCOUNTS',
        short: 'ACCOUNT',
      },
    ],
    edges: ['Payee', 'Account', 'Transfer Account'],
  },
];

export const datasetOf = (id: IOverviewDatasetId) => OVERVIEW_DATASETS.find((d) => d.id === id)!;
