import { Inject, Injectable, Logger } from '@nestjs/common';
import { KnowledgeSearch } from '../../application/knowledge/knowledge-search';
import {
  DATA_GATEWAY_PORT,
  type IDataGatewayPort,
  type IRankedId,
  type IReadOptions,
  type ISearchReaderPort,
} from '../../domain/ports';
import type { IFieldRecord, ISchemaField, ITableSchema } from '../../domain/search/schema';

/** Records a data-layer call returns at most (AI_DATA_MAX_RECORDS_PER_CALL default). */
const pageSize = 50;
/** Ids a link filter carries at most. */
const maxFilterIds = 200;

interface IRecordsResult {
  records?: IFieldRecord[];
}

const recordsOf = (result: unknown) => ((result as IRecordsResult)?.records ?? []).filter(Boolean);

const and = (...conditions: unknown[]) => {
  const set = conditions.filter(Boolean);
  return set.length ? { conjunction: 'and', filterSet: set } : undefined;
};

const primaryOf = (table: ITableSchema) => table.fields.find((f) => f.isPrimary) ?? table.fields[0];

/** The search executor's reads (cockpit design §6.6), over the data gateway and the full-text index. */
@Injectable()
export class SearchReader implements ISearchReaderPort {
  private readonly logger = new Logger(SearchReader.name);

  constructor(
    @Inject(DATA_GATEWAY_PORT) private readonly data: IDataGatewayPort,
    private readonly knowledge: KnowledgeSearch
  ) {}

  async titleMatches(
    table: ITableSchema,
    text: string,
    options: IReadOptions & { filter?: unknown }
  ) {
    const primary = primaryOf(table);
    if (!primary) return [];
    return recordsOf(
      await this.data.queryRecords({
        baseId: table.baseId,
        table: table.id,
        filter: and({ fieldId: primary.name, operator: 'contains', value: text }, options.filter),
        take: Math.min(options.take, pageSize),
        includeDeleted: options.includeDeleted,
      })
    );
  }

  async fullText(table: ITableSchema, text: string, take: number): Promise<IRankedId[]> {
    try {
      const found = await this.knowledge.search({
        query: text,
        collections: ['records', 'kb_records'],
        tableIds: [table.id],
        topK: take,
      });
      const best = new Map<string, number>();
      for (const r of found.results) {
        const id = r.recordRef?.tableId === table.id ? r.recordRef.recordId : undefined;
        if (id && !best.has(id)) best.set(id, r.score);
      }
      return [...best].map(([recordId, rank]) => ({ recordId, rank }));
    } catch (error) {
      // the index may still be syncing or switched off: the title match and quick search remain
      this.logger.warn(`full-text search in ${table.name} failed: ${(error as Error).message}`);
      return [];
    }
  }

  async quickSearch(
    table: ITableSchema,
    text: string,
    options: IReadOptions & { filter?: unknown }
  ) {
    return recordsOf(
      await this.data.queryRecords({
        baseId: table.baseId,
        table: table.id,
        search: text,
        filter: options.filter,
        take: Math.min(options.take, pageSize),
        includeDeleted: options.includeDeleted,
      })
    );
  }

  async byIds(table: ITableSchema, ids: string[]) {
    const out = new Map<string, IFieldRecord>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += pageSize) {
      const result = await this.data.getRecords({
        baseId: table.baseId,
        table: table.id,
        recordIds: unique.slice(i, i + pageSize),
      });
      for (const r of recordsOf(result)) out.set(r.id, r);
    }
    return unique.map((id) => out.get(id)).filter((r): r is IFieldRecord => Boolean(r));
  }

  async filter(
    table: ITableSchema,
    filter: unknown,
    options: IReadOptions & { orderBy?: { field: string; order: 'asc' | 'desc' }[] }
  ) {
    const records = recordsOf(
      await this.data.queryRecords({
        baseId: table.baseId,
        table: table.id,
        filter,
        orderBy: options.orderBy,
        take: Math.min(options.take, pageSize),
        includeDeleted: options.includeDeleted,
      })
    );
    let total = records.length;
    if (records.length >= Math.min(options.take, pageSize)) {
      const counted = await this.data
        .aggregate({ baseId: table.baseId, table: table.id, metrics: [], filter })
        .catch(() => undefined);
      total = counted?.rowCount ?? total;
    }
    return { records, total };
  }

  async linkedTo(table: ITableSchema, field: ISchemaField, ids: string[], options: IReadOptions) {
    const multiple =
      field.link?.relationship === 'manyMany' || field.link?.relationship === 'oneMany';
    return recordsOf(
      await this.data.queryRecords({
        baseId: table.baseId,
        table: table.id,
        filter: and({
          fieldId: field.name,
          operator: multiple ? 'hasAnyOf' : 'isAnyOf',
          value: [...new Set(ids)].slice(0, maxFilterIds),
        }),
        take: Math.min(options.take, pageSize),
        includeDeleted: options.includeDeleted,
      })
    );
  }

  async totals(table: ITableSchema, fields: string[], filter: unknown) {
    const result = await this.data.aggregate({
      baseId: table.baseId,
      table: table.id,
      metrics: fields.map((field) => ({ field, func: 'sum' })),
      filter,
    });
    const out: Record<string, number> = {};
    for (const v of result.values) if (typeof v.value === 'number') out[v.field] = v.value;
    return out;
  }
}
