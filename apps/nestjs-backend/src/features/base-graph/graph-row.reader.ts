/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import type { IFieldInstance } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import type { IGraphRow, ITableRows } from './assembler';
import type { IGraphPlan, IGraphTablePlan } from './graph-plan.resolver';
import { extractLinkCell, extractRelatedRecordIds } from './link-cells';

/** Tables read at once. One connection pool serves every request. */
const READ_CONCURRENCY = 4;

/**
 * The primary field rendered as text. `cellValue2String` handles every primary
 * type — formula, number, link, user — the same way the grid's copy does.
 * dbRecord2RecordFields drops null cells, so the key may be absent.
 */
export const labelOf = (primary: IFieldInstance, raw: unknown): string => {
  if (raw == null) {
    return '';
  }
  try {
    return primary.cellValue2String(raw);
  } catch {
    return typeof raw === 'string' ? raw : '';
  }
};

export const toGraphRow = (
  table: Pick<IGraphTablePlan, 'primaryField' | 'hierarchyField' | 'groupField' | 'readFields'>,
  record: { id: string; fields: Record<string, unknown> }
): IGraphRow => {
  const group = table.groupField ? extractLinkCell(record.fields[table.groupField.id]) : null;
  return {
    recordId: record.id,
    title: labelOf(table.primaryField, record.fields[table.primaryField.id]),
    parentRecordId: table.hierarchyField
      ? extractLinkCell(record.fields[table.hierarchyField.id])?.id ?? null
      : null,
    group: group ? { recordId: group.id, title: group.title ?? '' } : null,
    links: table.readFields.map((field) => ({
      fieldId: field.id,
      targetRecordIds: extractRelatedRecordIds(record.fields[field.id]),
    })),
  };
};

const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

@Injectable()
export class GraphRowReader {
  constructor(private readonly recordService: RecordService) {}

  /**
   * One SQL statement per table through RecordService, so view filters,
   * permission wrapping and filter compilation are the same as the grid's.
   * `take` is the limit plus one: the extra row is how truncation is detected
   * without a COUNT(*).
   *
   * Only reachable from a request — getRecordsFields reads the user from CLS.
   */
  async read(plan: IGraphPlan): Promise<Map<string, ITableRows>> {
    const results = await mapWithConcurrency(plan.tables, READ_CONCURRENCY, (table) =>
      this.readTable(table)
    );
    return new Map(plan.tables.map((table, i) => [table.tableId, results[i]]));
  }

  private async readTable(table: IGraphTablePlan): Promise<ITableRows> {
    const projection = [
      table.primaryField.id,
      table.hierarchyField?.id,
      table.groupField?.id,
      ...table.readFields.map((f) => f.id),
    ].filter((id): id is string => Boolean(id));

    const records = await this.recordService.getRecordsFields(
      table.tableId,
      {
        fieldKeyType: FieldKeyType.Id,
        projection: [...new Set(projection)],
        viewId: table.viewId,
        // Without a view the graph is table-wide; with one, the view's filter
        // and sort apply and `filter` is ANDed onto it.
        ignoreViewQuery: !table.viewId,
        filter: table.filter,
        take: table.limit + 1,
      },
      true
    );

    const truncated = records.length > table.limit;
    const kept = truncated ? records.slice(0, table.limit) : records;
    return { rows: kept.map((record) => toGraphRow(table, record)), truncated };
  }
}
