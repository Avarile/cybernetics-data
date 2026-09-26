import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataPrismaService } from '@teable/db-data-prisma';
import type { IBaseGraphVo } from '@teable/openapi';
import { BASE_GRAPH_VERSION } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import type { IClsStore } from '../../types/cls';
import { RecordService } from '../record/record.service';
import type { IGraphPlan, IGraphTablePlan } from './graph-plan.resolver';
import { linkOptionsOf } from './graph-plan.resolver';

interface IProbeRow {
  n: number | string | bigint;
  m: Date | string | null;
}

const sha1 = (value: unknown) =>
  createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** Everything about the schema that shapes the payload: labels, field types, link targets. */
const schemaFingerprint = (plan: IGraphPlan) => ({
  assembler: plan.assembler,
  fields: plan.tables.map((t) =>
    [t.primaryField, t.hierarchyField, t.groupField, ...t.readFields]
      .filter(Boolean)
      .map((f) => ({ id: f!.id, name: f!.name, type: f!.type, options: f!.options }))
  ),
  limits: plan.tables.map((t) => [t.tableId, t.viewId ?? null, t.filter ?? null, t.limit]),
});

/**
 * An ETag computed BEFORE reading rows: one aggregate per table — row count and
 * the newest `__last_modified_time` (or `__created_time` for never-edited
 * rows) under the same filter the read will use — plus a fingerprint of the
 * plan and the user. Unchanged data therefore costs one cheap query per table
 * and no assembly.
 *
 * Deletes lower the count; edits raise the max; schema and label changes move
 * the fingerprint. A synthetic group's label comes from the link cell's title,
 * which reflects the target table, so that table is probed too even though it
 * is not in the graph.
 *
 * The probe goes through RecordService.buildFilterSortQuery, so view filters,
 * the ad-hoc filter and permission wrapping compile exactly as for the read.
 * It steps aside (returns null) when a table's payload depends on a computed
 * field, and when it fails for any reason; the caller then hashes the full
 * payload and does not cache.
 */
@Injectable()
export class GraphEtagService {
  private readonly logger = new Logger(GraphEtagService.name);

  constructor(
    private readonly recordService: RecordService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly cacheService: CacheService,
    private readonly cls: ClsService<IClsStore>,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {}

  async probe(plan: IGraphPlan): Promise<string | null> {
    if (plan.tables.some((t) => !t.probeSafe)) {
      return null;
    }
    try {
      const probes = await Promise.all(plan.tables.map((table) => this.probeTable(table)));
      const groupTargets = plan.tables
        .filter((t) => t.groupField && !t.groupTargetTableId)
        .map((t) => linkOptionsOf(t.groupField!).foreignTableId);
      const targetProbes = await Promise.all(
        [...new Set(groupTargets)].sort().map((tableId) => this.probeTable({ tableId }))
      );
      const digest = sha1({
        v: BASE_GRAPH_VERSION,
        user: this.cls.get('user.id') ?? null,
        schema: schemaFingerprint(plan),
        probes,
        targetProbes,
      });
      return `"bg${BASE_GRAPH_VERSION}-${digest}"`;
    } catch (error) {
      this.logger.warn(`ETag probe failed, falling back to payload hash: ${String(error)}`);
      return null;
    }
  }

  /** Full-payload ETag, used when the probe is unavailable. */
  payloadEtag(payload: unknown): string {
    return `"bg${BASE_GRAPH_VERSION}-p${sha1(payload)}"`;
  }

  async getCached(baseId: string, etag: string): Promise<IBaseGraphVo | undefined> {
    return this.cacheService.get(`base-graph:${baseId}:${etag}`);
  }

  async setCached(
    baseId: string,
    etag: string,
    value: IBaseGraphVo,
    ttlSeconds: number
  ): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }
    await this.cacheService.setDetail(`base-graph:${baseId}:${etag}`, value, ttlSeconds);
  }

  private async probeTable(
    table: Pick<IGraphTablePlan, 'tableId'> & Partial<Pick<IGraphTablePlan, 'viewId' | 'filter'>>
  ): Promise<[string, string, string | null]> {
    const { queryBuilder, dbTableName, alias } = await this.recordService.buildFilterSortQuery(
      table.tableId,
      { viewId: table.viewId, ignoreViewQuery: !table.viewId, filter: table.filter },
      true
    );
    queryBuilder.clearSelect().clearOrder().select(`${alias}.__id`);

    const sql = this.knex
      .select(
        this.knex.raw('count(*) as n'),
        this.knex.raw('max(coalesce(??, ??)) as m', ['__last_modified_time', '__created_time'])
      )
      .from(dbTableName)
      .whereIn('__id', queryBuilder)
      .toQuery();

    const [row] = await this.dataPrismaService.txClient().$queryRawUnsafe<IProbeRow[]>(sql);
    const m = row?.m instanceof Date ? row.m.toISOString() : row?.m ?? null;
    return [table.tableId, String(row?.n ?? 0), m];
  }
}
