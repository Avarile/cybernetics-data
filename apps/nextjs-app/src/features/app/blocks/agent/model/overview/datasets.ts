import type { IOverviewDatasetId } from '@teable/openapi';

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
  legend: ILegendEntry[];
}

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
    legend: [...work, ['none', 'GOAL', 'ring'], ['target', 'PERSON', 'diamond']],
  },
  {
    id: 'knowledge',
    chip: 'KNOWLEDGE',
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
    legend: [
      ['none', 'PERSON · TYPE', 'ring'],
      ...work.filter(([tone]) => tone !== 'ink' && tone !== 'faint'),
      ['target', 'PROFESSION · COMPANY', 'diamond'],
    ],
  },
  {
    id: 'finance',
    chip: 'FINANCE',
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
