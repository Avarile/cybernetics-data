import { HttpErrorCode, StatisticsFunc } from '@cybernetics/core';
import type { IFilter } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../../../custom.exception';
import { AggregationOpenApiService } from '../../../aggregation/open-api/aggregation-open-api.service';
import type { IAiDataFieldSummary } from '../../../ai-data/ai-data.schema';
import { resolveFieldRef, translateFilter } from '../../../ai-data/ai-data.schema';
import { AiDataService } from '../../../ai-data/ai-data.service';
import type {
  IDataFieldSpec,
  IDataGatewayPort,
  IDataMetric,
  IDataQuery,
  IDataTableRef,
} from '../../domain/ports';
import { UnrestrictedDataWriter } from './unrestricted-data-writer';

const listCap = 500;
const searchTables = 10;
const searchRowsPerTable = 3;

const contains = (text: string, query: string) => text.toLowerCase().includes(query.toLowerCase());

/**
 * DataGatewayPort over Teable's own services (design §5.3). Must be called inside an agent run:
 * the services check permissions against the CLS principal, which the run sets to the agent.
 */
@Injectable()
export class UnrestrictedDataGateway implements IDataGatewayPort {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiData: AiDataService,
    private readonly aggregation: AggregationOpenApiService,
    private readonly writer: UnrestrictedDataWriter
  ) {}

  createRecords(ref: IDataTableRef & { records: Record<string, unknown>[] }) {
    return this.writer.createRecords(ref);
  }

  updateRecords(
    ref: IDataTableRef & { records: { id: string; fields: Record<string, unknown> }[] }
  ) {
    return this.writer.updateRecords(ref);
  }

  deleteRecords(ref: IDataTableRef & { recordIds: string[] }) {
    return this.writer.deleteRecords(ref);
  }

  createTable(input: { baseId: string; name: string; fields: IDataFieldSpec[] }) {
    return this.writer.createTable(input);
  }

  createField(ref: IDataTableRef & { field: IDataFieldSpec }) {
    return this.writer.createField(ref);
  }

  updateField(ref: IDataTableRef & { field: string; patch: Partial<IDataFieldSpec> }) {
    return this.writer.updateField(ref);
  }

  deleteField(ref: IDataTableRef & { field: string }) {
    return this.writer.deleteField(ref);
  }

  deleteTable(ref: IDataTableRef) {
    return this.writer.deleteTable(ref);
  }

  async listSpaces() {
    return this.prismaService.space.findMany({
      where: { deletedTime: null },
      select: { id: true, name: true },
      orderBy: { createdTime: 'asc' },
      take: listCap,
    });
  }

  async listBases(spaceId?: string) {
    return this.prismaService.base.findMany({
      where: { deletedTime: null, ...(spaceId ? { spaceId } : {}) },
      select: { id: true, name: true, spaceId: true },
      orderBy: [{ spaceId: 'asc' }, { order: 'asc' }],
      take: listCap,
    });
  }

  listTables(baseId: string) {
    return this.aiData.listTables(baseId);
  }

  describeTable({ baseId, table }: IDataTableRef) {
    return this.aiData.describeTable(baseId, table);
  }

  queryRecords(q: IDataQuery) {
    return this.aiData.queryRecords(q.baseId, {
      tableId: q.table,
      filter: q.filter as never,
      orderBy: q.orderBy?.map((o) => ({ fieldId: o.field, order: o.order })) as never,
      search: q.search,
      projection: q.fields,
      take: q.take,
      skip: q.skip,
      includeDeleted: q.includeDeleted,
      fieldKeyType: 'name',
    });
  }

  getRecords({ baseId, table, recordIds }: IDataTableRef & { recordIds: string[] }) {
    return this.aiData.getRecords(baseId, table, recordIds, { fieldKeyType: 'name' });
  }

  async aggregate({
    baseId,
    table,
    metrics,
    filter,
  }: IDataTableRef & { metrics: IDataMetric[]; filter?: unknown }) {
    const described = (await this.aiData.describeTable(baseId, table)) as {
      id: string;
      name: string;
      fields: IAiDataFieldSummary[];
    };
    const funcs = Object.values(StatisticsFunc) as string[];
    const byFunc: Record<string, string[]> = {};
    const resolved = metrics.map((m) => {
      if (!funcs.includes(m.func)) {
        throw new CustomHttpException(
          `Unknown function ${m.func}; use one of ${funcs.join(', ')}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      const fieldId = resolveFieldRef(m.field, described.fields, described.name);
      (byFunc[m.func] ??= []).push(fieldId);
      return { ...m, fieldId };
    });
    const customFilter =
      (filter
        ? translateFilter(filter as NonNullable<IFilter>, described.fields, described.name)
        : null) ?? undefined;
    const [{ rowCount }, result] = await Promise.all([
      this.aggregation.getRowCount(described.id, { filter: customFilter, ignoreViewQuery: true }),
      resolved.length
        ? this.aggregation.getAggregation(described.id, {
            field: byFunc,
            filter: customFilter,
            ignoreViewQuery: true,
          })
        : Promise.resolve({ aggregations: [] }),
    ]);
    const aggregations = (result.aggregations ?? []) as {
      fieldId: string;
      total?: { aggFunc: string; value: unknown } | null;
    }[];
    return {
      rowCount,
      values: resolved.map((m) => ({
        field: m.field,
        func: m.func,
        value:
          aggregations.find((a) => a.fieldId === m.fieldId && a.total?.aggFunc === m.func)?.total
            ?.value ?? null,
      })),
    };
  }

  /** Names of spaces, bases and tables; with a base, also matching rows of its tables. */
  async searchEverywhere(query: string, options: { baseId?: string; limit?: number } = {}) {
    const limit = Math.min(options.limit ?? 20, 50);
    const [spaces, bases] = await Promise.all([this.listSpaces(), this.listBases()]);
    const tables = await this.prismaService.tableMeta.findMany({
      where: { deletedTime: null, base: { deletedTime: null } },
      select: { id: true, name: true, baseId: true },
      take: 5_000,
    });
    const result: Record<string, unknown> = {
      spaces: spaces.filter((s) => contains(s.name, query)).slice(0, limit),
      bases: bases.filter((b) => contains(b.name, query)).slice(0, limit),
      tables: tables.filter((t) => contains(t.name, query)).slice(0, limit),
    };
    if (options.baseId) {
      const baseTables = (await this.listTables(options.baseId)).slice(0, searchTables);
      const rows = [];
      for (const t of baseTables) {
        const found = (await this.queryRecords({
          baseId: options.baseId,
          table: t.id,
          search: query,
          take: searchRowsPerTable,
        })) as { records: unknown[] };
        if (found.records.length)
          rows.push({ tableId: t.id, table: t.name, records: found.records });
      }
      result.records = rows;
    }
    return result;
  }
}
