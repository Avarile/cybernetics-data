import type { IAgentTableOverviewVo, IOverviewDatasetId, ISearchTone } from '@teable/openapi';

/** How long each table stays on the stage (overview design §6.1, scope design §5.3). */
export const DATASET_MS = 60_000;
/** The next table is fetched this long before it is due. */
export const PREFETCH_MS = 10_000;

/** A legend entry: tone, words, and the mark (dot when none). */
export type ILegendEntry = [
  tone: string,
  label: string,
  mark?: 'ring' | 'halo' | 'diamond' | 'hatch',
];

/** What the rail and the legend say about the table on the stage (scope design §9.3). */
export interface ITableInfo {
  id: string;
  /** The table's name as the HUD and the menu show it. */
  chip: string;
  /** The curated dataset that draws it, whose words the client translates. */
  preset: IOverviewDatasetId | null;
  legend: ILegendEntry[];
  /** The vectors panel's title (TYPES), and what a branch counts. */
  branchTitle: string;
  unit: string;
  /** What each tone means on this table, for the vectors' facts. */
  toneNames: Partial<Record<ISearchTone, string>>;
  /** A vector's right-hand figure: the share done, or the money moved. */
  right?: 'pct' | 'sum';
}

/** A table before its overview arrives: its name, and nothing to say yet. */
export const pendingInfo = (id: string, name: string): ITableInfo => ({
  id,
  chip: name.toUpperCase(),
  preset: null,
  legend: [],
  branchTitle: name.toUpperCase(),
  unit: 'RECORDS',
  toneNames: {},
});

/** The presentation the server sent with a table's overview. */
export const tableInfo = (vo: IAgentTableOverviewVo): ITableInfo => ({
  id: vo.tableId,
  chip: vo.tableName.toUpperCase(),
  preset: vo.preset,
  legend: vo.presentation.legend as ILegendEntry[],
  branchTitle: vo.presentation.branchTitle,
  unit: vo.presentation.unit,
  toneNames: vo.presentation.toneNames as ITableInfo['toneNames'],
  ...(vo.presentation.right ? { right: vo.presentation.right } : {}),
});
