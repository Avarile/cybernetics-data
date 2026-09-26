import type { IBaseGraphLink, IBaseGraphNode, IBaseGraphStats } from '@teable/openapi';
import type { IHierarchyRow } from '../hierarchy';

/**
 * One record as the assembler sees it. `title` is the primary field rendered to
 * text; `parentRecordId` is the hierarchy self-link (null when the table has
 * none configured) — the same shape the hierarchy engine consumes.
 */
export interface IGraphRow extends IHierarchyRow {
  /** The group link cell, when a group field is configured and the cell is set. */
  group: { recordId: string; title: string } | null;
  /** Only link fields the plan marks as read-side; the other side of a pair is skipped. */
  links: { fieldId: string; targetRecordIds: string[] }[];
}

export interface IAssemblerTable {
  tableId: string;
  name: string;
  /** Single-valued self-link drawing the table as a tree, if configured. */
  hierarchyFieldId: string | null;
  groupFieldId: string | null;
  /** Foreign table of the group field, when that table is also in the graph. */
  groupTargetTableId: string | null;
  /**
   * Link fields drawn as `link` edges, keyed to the id shared by both sides of
   * a two-way pair (the smaller of fieldId/symmetricFieldId) so the pair dedupes
   * to one edge whichever side it was read from.
   */
  edgeFields: { fieldId: string; pairId: string }[];
}

/** Serialisable subset of the resolved plan — specs build it by hand. */
export interface IAssemblerPlan {
  tables: IAssemblerTable[];
  maxNodes: number;
  maxLinks: number;
  showTableHubs: boolean;
  showBaseHub: boolean;
  baseLabel: string;
  unclassifiedLabel: string;
}

export interface ITableRows {
  rows: IGraphRow[];
  /** The reader fetched more rows than the table limit. */
  truncated: boolean;
}

export interface IAssembledBaseGraph {
  nodes: IBaseGraphNode[];
  links: IBaseGraphLink[];
  stats: IBaseGraphStats;
}
