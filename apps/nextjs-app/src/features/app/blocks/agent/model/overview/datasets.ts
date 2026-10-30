import type { IOverviewDatasetId, ISearchTone } from '@teable/openapi';

/** How long each dataset stays on the stage (overview design §6.1). */
export const DATASET_MS = 60_000;
/** The next dataset is fetched this long before it is due. */
export const PREFETCH_MS = 10_000;

/** A legend entry: tone, words, and the mark (dot when none). */
export type ILegendEntry = [
  tone: string,
  label: string,
  mark?: 'ring' | 'halo' | 'diamond' | 'hatch',
];

export interface IOverviewDatasetInfo {
  id: IOverviewDatasetId;
  chip: string;
  /** Where it comes from and what it holds, for the dataset menu (the cockpit's list). */
  source: string;
  about: string;
  legend: ILegendEntry[];
  /** The vectors panel's title, the flight log's, and what a branch counts. */
  branchTitle: string;
  feedTitle: string;
  unit: string;
  /** What each tone means in this dataset, for the vectors' facts. */
  toneNames: Partial<Record<ISearchTone, string>>;
  /** The flight log's verb for a record of each tone (one short word). */
  verbs: Partial<Record<ISearchTone, string>>;
  /** A vector's right-hand figure: the share done, or the money moved. */
  right?: 'pct' | 'sum';
}

const workTones: IOverviewDatasetInfo['toneNames'] = {
  route: 'IN PROGRESS',
  target: 'PLANNED',
  dim: 'BACKLOG',
  ink: 'FINISHED',
  caution: 'ON HOLD',
  faint: 'CANCELLED',
};

const workVerbs: IOverviewDatasetInfo['verbs'] = {
  route: 'ACTIVE',
  target: 'NEXT',
  ink: 'DONE',
  dim: 'BACKLOG',
  caution: 'HOLD',
  faint: 'DROPPED',
};

const work: ILegendEntry[] = [
  ['route', 'IN PROGRESS'],
  ['target', 'NEXT'],
  ['ink', 'DONE'],
  ['dim', 'BACKLOG'],
  ['caution', 'ON HOLD · LATE', 'halo'],
  ['faint', 'CANCELLED'],
];

/** The datasets in the order the overview shows them, with their chips and legends. */
export const OVERVIEW_ORDER: IOverviewDatasetInfo[] = [
  {
    id: 'work',
    chip: 'WORK',
    source: 'DATABASE',
    about: 'GOALS, PROJECTS, TASKS AND PEOPLE',
    branchTitle: 'GOAL VECTORS',
    feedTitle: 'RECENT WORK',
    unit: 'ITEMS',
    toneNames: workTones,
    verbs: workVerbs,
    right: 'pct',
    legend: [...work, ['none', 'GOAL', 'ring'], ['target', 'PERSON', 'diamond']],
  },
  {
    id: 'knowledge',
    chip: 'KNOWLEDGE',
    source: 'DATABASE',
    about: 'ENTRIES AND TYPES',
    branchTitle: 'TYPES',
    feedTitle: 'RECENTLY UPDATED',
    unit: 'ENTRIES',
    toneNames: { route: 'UPDATED 7D', target: 'UPDATED 30D', ink: 'OLDER' },
    verbs: { route: 'UPDATED', target: 'UPDATED', ink: 'UPDATED' },
    legend: [
      ['route', 'UPDATED ≤ 7 DAYS'],
      ['target', 'UPDATED ≤ 30 DAYS'],
      ['ink', 'OLDER'],
      ['none', 'TYPE', 'ring'],
    ],
  },
  {
    id: 'people',
    chip: 'PEOPLE',
    source: 'DATABASE',
    about: 'PEOPLE AND THEIR OPEN WORK',
    branchTitle: 'CONTACT TYPES',
    feedTitle: 'RECENT WORK',
    unit: 'OPEN ITEMS',
    toneNames: workTones,
    verbs: workVerbs,
    legend: [
      ['none', 'PERSON · TYPE', 'ring'],
      ...work.filter(([tone]) => tone !== 'ink' && tone !== 'faint'),
      ['target', 'PROFESSION · COMPANY', 'diamond'],
    ],
  },
  {
    id: 'finance',
    chip: 'FINANCE',
    source: 'DATABASE',
    about: 'TRANSACTIONS, PAYEES, ACCOUNTS',
    branchTitle: 'CATEGORIES',
    feedTitle: 'LATEST TRANSACTIONS',
    unit: 'TRANSACTIONS',
    toneNames: { route: 'EXPENSE', target: 'INCOME', dim: 'TRANSFER' },
    verbs: { route: 'EXPENSE', target: 'INCOME', dim: 'TRANSFER' },
    right: 'sum',
    legend: [
      ['route', 'EXPENSE'],
      ['target', 'INCOME'],
      ['dim', 'TRANSFER'],
      ['none', 'CATEGORY', 'ring'],
      ['target', 'PAYEE · ACCOUNT', 'diamond'],
    ],
  },
];

export const datasetInfo = (id: IOverviewDatasetId) =>
  OVERVIEW_ORDER.find((d) => d.id === id) ?? OVERVIEW_ORDER[0];
