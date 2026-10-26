import type { IFilterItem, IFilterSet } from '@cybernetics/core';
import { FieldKeyType, SortFunc } from '@cybernetics/core';
import type { IGetRecordsRo } from '@teable/openapi';
import type { RecordOpenApiService } from '../../../record/open-api/record-open-api.service';
import type { RecordService } from '../../../record/record.service';
import type { IAgentLayout } from '../../domain/ports';
import type { IEntitySpec } from './entity-specs';
import { projectionOf, readEntity, writeEntity } from './entity-specs';

const pageSize = 500;

export interface IRepoDeps {
  layout(): Promise<IAgentLayout>;
  records: RecordService;
  recordsApi: RecordOpenApiService;
  /** Runs record work as the agent (inside the current run, or a run of its own). */
  scoped<T>(fn: () => Promise<T>): Promise<T>;
}

/** Turns pack field keys into field ids while a filter is built. */
export type IFieldResolver = (packKey: string) => string;

export interface IFindOptions {
  where?: (field: IFieldResolver) => (IFilterItem | IFilterSet)[];
  orderBy?: [packKey: string, order: 'asc' | 'desc'][];
  /** Omit to read every matching row (paged). */
  take?: number;
  skip?: number;
}

/**
 * One agent table as a repository of entities. Field ids come from the installation layout on
 * each call, so a renamed column or a repaired table is picked up without a restart.
 */
export class TableRepo<E extends { id: string }> {
  constructor(
    private readonly spec: IEntitySpec<E>,
    private readonly deps: IRepoDeps
  ) {}

  private async ids() {
    const layout = await this.deps.layout();
    const tableId = layout.tableMap[this.spec.table];
    if (!tableId) throw new Error(`Agent table ${this.spec.table} is not installed`);
    return { tableId, fields: layout.fieldMap[this.spec.table] ?? {} };
  }

  async find(options: IFindOptions = {}): Promise<E[]> {
    const { tableId, fields } = await this.ids();
    const field: IFieldResolver = (key) => {
      if (!fields[key]) throw new Error(`Agent table ${this.spec.table} has no field ${key}`);
      return fields[key];
    };
    const filterSet = options.where?.(field) ?? [];
    const query: IGetRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      projection: projectionOf(this.spec, fields),
      ignoreViewQuery: true,
      ...(filterSet.length ? { filter: { conjunction: 'and', filterSet } } : {}),
      ...(options.orderBy?.length
        ? {
            orderBy: options.orderBy.map(([key, order]) => ({
              fieldId: field(key),
              order: order === 'asc' ? SortFunc.Asc : SortFunc.Desc,
            })),
          }
        : {}),
    };
    return this.deps.scoped(async () => {
      if (options.take !== undefined) {
        const { records } = await this.deps.records.getRecords(tableId, {
          ...query,
          take: options.take,
          skip: options.skip,
        });
        return records.map((r) => readEntity(this.spec, fields, r));
      }
      const all: E[] = [];
      for (let skip = options.skip ?? 0; ; skip += pageSize) {
        const { records } = await this.deps.records.getRecords(tableId, {
          ...query,
          take: pageSize,
          skip,
        });
        all.push(...records.map((r) => readEntity(this.spec, fields, r)));
        if (records.length < pageSize) return all;
      }
    });
  }

  async get(id: string): Promise<E> {
    const { tableId, fields } = await this.ids();
    const record = await this.deps.scoped(() =>
      this.deps.records.getRecord(tableId, id, {
        fieldKeyType: FieldKeyType.Id,
        projection: projectionOf(this.spec, fields),
      })
    );
    return readEntity(this.spec, fields, record);
  }

  async create(rows: Partial<Omit<E, 'id'>>[]): Promise<E[]> {
    if (!rows.length) return [];
    const { tableId, fields } = await this.ids();
    const created = await this.deps.scoped(() =>
      this.deps.recordsApi.createRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: rows.map((row) => ({ fields: writeEntity(this.spec, fields, row) })),
      })
    );
    // read back: computed fields (created_at, counts) are filled in by now
    return Promise.all(created.records.map((r) => this.get(r.id)));
  }

  async update(id: string, patch: Partial<Omit<E, 'id'>>): Promise<E> {
    const { tableId, fields } = await this.ids();
    const cells = writeEntity(this.spec, fields, patch);
    if (Object.keys(cells).length) {
      await this.deps.scoped(() =>
        this.deps.recordsApi.updateRecord(tableId, id, {
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
          record: { fields: cells },
        })
      );
    }
    return this.get(id);
  }

  async delete(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const { tableId } = await this.ids();
    await this.deps.scoped(() => this.deps.recordsApi.deleteRecords(tableId, ids));
  }
}
