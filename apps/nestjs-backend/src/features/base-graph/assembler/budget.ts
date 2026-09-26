import { byTitleThenId } from '../hierarchy';
import type { IAssemblerPlan, IGraphRow, ITableRows } from './types';

export interface IBudgetedTable {
  rows: IGraphRow[];
  truncated: boolean;
}

/**
 * Sorts each table deterministically, then — only if the tables together exceed
 * `maxNodes` — gives each a share proportional to its size. Leftover slots from
 * flooring go to tables in plan order. Sort before slicing, so the same data
 * always yields the same subset and the ETag stays stable.
 */
export const applyBudget = (
  plan: Pick<IAssemblerPlan, 'tables' | 'maxNodes'>,
  rowsByTable: ReadonlyMap<string, ITableRows>
): Map<string, IBudgetedTable> => {
  const sorted = plan.tables.map((table) => {
    const input = rowsByTable.get(table.tableId) ?? { rows: [], truncated: false };
    return {
      tableId: table.tableId,
      rows: [...input.rows].sort(byTitleThenId),
      truncated: input.truncated,
    };
  });

  const total = sorted.reduce((sum, t) => sum + t.rows.length, 0);
  const result = new Map<string, IBudgetedTable>();

  if (total <= plan.maxNodes) {
    for (const t of sorted) {
      result.set(t.tableId, { rows: t.rows, truncated: t.truncated });
    }
    return result;
  }

  const shares = sorted.map((t) => Math.floor((plan.maxNodes * t.rows.length) / total));
  let leftover = plan.maxNodes - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; leftover > 0 && i < sorted.length; i++) {
    if (shares[i] < sorted[i].rows.length) {
      shares[i]++;
      leftover--;
    }
  }

  sorted.forEach((t, i) => {
    const cut = t.rows.length > shares[i];
    result.set(t.tableId, {
      rows: cut ? t.rows.slice(0, shares[i]) : t.rows,
      truncated: t.truncated || cut,
    });
  });
  return result;
};
