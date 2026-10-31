/* eslint-disable @typescript-eslint/naming-convention */
import type {
  IOverviewDatasetId,
  IOverviewLegendEntry,
  IOverviewPresentation,
} from '@teable/openapi';

/** Scope design §9.3: what the rail and the legend say about a table on the stage. */

export const WORK_TONES: Record<string, string> = {
  route: 'IN PROGRESS',
  target: 'PLANNED',
  dim: 'BACKLOG',
  ink: 'FINISHED',
  caution: 'ON HOLD',
  faint: 'CANCELLED',
};

export const WORK_LEGEND: IOverviewLegendEntry[] = [
  ['route', 'IN PROGRESS'],
  ['target', 'NEXT'],
  ['ink', 'DONE'],
  ['dim', 'BACKLOG'],
  ['caution', 'ON HOLD · LATE', 'halo'],
  ['faint', 'CANCELLED'],
];

export const FRESH_TONES: Record<string, string> = {
  route: 'UPDATED 7D',
  target: 'UPDATED 30D',
  ink: 'OLDER',
};

export const FRESH_LEGEND: IOverviewLegendEntry[] = [
  ['route', 'UPDATED ≤ 7 DAYS'],
  ['target', 'UPDATED ≤ 30 DAYS'],
  ['ink', 'OLDER'],
];

/** What the cockpit showed for each dataset before tables (its OVERVIEW_ORDER), unchanged. */
export const PRESENTATIONS: Record<IOverviewDatasetId, IOverviewPresentation> = {
  work: {
    branchTitle: 'GOAL VECTORS',
    unit: 'ITEMS',
    right: 'pct',
    toneNames: WORK_TONES,
    legend: [...WORK_LEGEND, ['none', 'GOAL', 'ring'], ['target', 'PERSON', 'diamond']],
  },
  knowledge: {
    branchTitle: 'TYPES',
    unit: 'ENTRIES',
    toneNames: FRESH_TONES,
    legend: [...FRESH_LEGEND, ['none', 'TYPE', 'ring']],
  },
  people: {
    branchTitle: 'CONTACT TYPES',
    unit: 'OPEN ITEMS',
    toneNames: WORK_TONES,
    legend: [
      ['none', 'PERSON · TYPE', 'ring'],
      ...WORK_LEGEND.filter(([tone]) => tone !== 'ink' && tone !== 'faint'),
      ['target', 'PROFESSION · COMPANY', 'diamond'],
    ],
  },
  finance: {
    branchTitle: 'CATEGORIES',
    unit: 'TRANSACTIONS',
    right: 'sum',
    toneNames: { route: 'EXPENSE', target: 'INCOME', dim: 'TRANSFER' },
    legend: [
      ['route', 'EXPENSE'],
      ['target', 'INCOME'],
      ['dim', 'TRANSFER'],
      ['none', 'CATEGORY', 'ring'],
      ['target', 'PAYEE · ACCOUNT', 'diamond'],
    ],
  },
};
