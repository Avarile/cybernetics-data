/* eslint-disable @typescript-eslint/naming-convention */
import type { IOverviewDatasetId, IOverviewPresentation } from '@teable/openapi';
import type { ISearchSchema } from '../ports';
import type { ITableSchema } from '../search/schema';
import { autoPreset } from './auto-preset';
import { datasetOf, type IOverviewDataset } from './datasets';
import { PRESENTATIONS } from './presentation';

/**
 * Scope design §9.2: the tables the curated datasets are drawn for. Each keeps its dataset's
 * look on the stage (knowledges keeps TYPES); every other table gets a derived preset.
 */
export const PRESET_ANCHORS: Record<string, IOverviewDatasetId> = {
  knowledges: 'knowledge',
  tasks: 'work',
  contacts: 'people',
  finance_transactions: 'finance',
};

export interface ITablePreset {
  dataset: IOverviewDataset;
  presentation: IOverviewPresentation;
  /** The curated dataset used, or null for a derived preset. */
  preset: IOverviewDatasetId | null;
}

/** How a table is drawn: by the dataset it anchors, else by a preset derived from it. Pure. */
export function presetOf(table: ITableSchema, schema: ISearchSchema): ITablePreset {
  const anchored = PRESET_ANCHORS[table.name.toLowerCase()];
  if (anchored) {
    return {
      dataset: datasetOf(anchored),
      presentation: PRESENTATIONS[anchored],
      preset: anchored,
    };
  }
  return { ...autoPreset(table, schema), preset: null };
}
