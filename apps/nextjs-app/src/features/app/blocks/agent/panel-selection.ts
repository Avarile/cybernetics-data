/** The grid selection the panel shows as context (rows the admin chose to add to the chat). */
export interface IGridSelection {
  rows: [number, number][] | null;
  timestamp: number;
  addToChat?: boolean;
}

export const PANEL_DEFAULT_WIDTH = 320;

/** Rows in the selection, unless the admin dismissed the context chip. */
export function countSelectedRows(
  selection: IGridSelection | null,
  contextDismissed: boolean
): number {
  if (!selection?.addToChat || contextDismissed || !selection.rows) return 0;
  return selection.rows.reduce((sum, [start, end]) => sum + (end - start + 1), 0);
}
