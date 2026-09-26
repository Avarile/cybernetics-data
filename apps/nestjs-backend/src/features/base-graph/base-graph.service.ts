/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  IBaseGraphLinkField,
  IBaseGraphQueryRo,
  IBaseGraphSchemaVo,
  IBaseGraphVo,
} from '@teable/openapi';
import { BASE_GRAPH_VERSION } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
// A value import: IBaseGraphConfig is referenced from a decorated constructor
// parameter, so it must survive into decorator metadata.
import { BaseGraphConfig, IBaseGraphConfig } from '../../configs/base-graph.config';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DATA_KNEX } from '../../global/knex/knex.module';
import type { IFieldInstance } from '../field/model/factory';
import { RecordService } from '../record/record.service';
import { assembleBaseGraph } from './assembler';
import { GraphEtagService } from './graph-etag.service';
import {
  GraphPlanResolver,
  isCrossBaseLink,
  isRealLinkField,
  linkOptionsOf,
} from './graph-plan.resolver';
import { GraphRowReader } from './graph-row.reader';

/** Below this planner estimate an exact COUNT(*) is cheap and far more honest. */
const EXACT_COUNT_BELOW = 10000;

export interface IBaseGraphQueryResult {
  etag: string;
  /** The caller's If-None-Match matched: send 304 with no body. */
  notModified: boolean;
  vo?: IBaseGraphVo;
}

export const describeLinkField = (
  field: IFieldInstance,
  tableId: string,
  baseId: string
): IBaseGraphLinkField => {
  const options = linkOptionsOf(field);
  return {
    id: field.id,
    name: field.name,
    foreignTableId: options.foreignTableId,
    relationship: options.relationship,
    isOneWay: Boolean(options.isOneWay),
    symmetricFieldId: options.symmetricFieldId ?? null,
    isSelfLink: options.foreignTableId === tableId,
    isMultipleCellValue: Boolean(field.isMultipleCellValue),
    isCrossBase: isCrossBaseLink(field, baseId),
  };
};

@Injectable()
export class BaseGraphService {
  private readonly logger = new Logger(BaseGraphService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly dataPrismaService: DataPrismaService,
    private readonly recordService: RecordService,
    private readonly resolver: GraphPlanResolver,
    private readonly reader: GraphRowReader,
    private readonly etagService: GraphEtagService,
    @BaseGraphConfig() private readonly config: IBaseGraphConfig,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {}

  /**
   * Metadata only — no record reads beyond row-count estimates. Not built on
   * the `/erd` route, which requires `base|update`; this is for every reader.
   */
  async getSchema(baseId: string): Promise<IBaseGraphSchemaVo> {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true, icon: true, dbTableName: true },
      orderBy: { order: 'asc' },
    });
    const views = await this.prismaService.view.findMany({
      where: { tableId: { in: tables.map((t) => t.id) }, deletedTime: null },
      select: { id: true, name: true, tableId: true },
      orderBy: { order: 'asc' },
    });

    const out: IBaseGraphSchemaVo['tables'] = [];
    for (const table of tables) {
      const fields = await this.recordService.getFieldsByProjection(table.id);
      const primary = fields.find((f) => f.isPrimary);
      if (!primary) {
        continue;
      }
      const linkFields = fields
        .filter(isRealLinkField)
        .map((f) => describeLinkField(f, table.id, baseId));
      const hierarchyCandidates = linkFields.filter((f) => f.isSelfLink && !f.isMultipleCellValue);
      out.push({
        id: table.id,
        name: table.name,
        icon: table.icon ?? null,
        primaryFieldId: primary.id,
        primaryFieldName: primary.name,
        approxRecordCount: await this.approxCount(table.dbTableName),
        views: views.filter((v) => v.tableId === table.id).map(({ id, name }) => ({ id, name })),
        fields: fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          isComputed: Boolean(f.isComputed),
        })),
        linkFields,
        suggestedHierarchyFieldId:
          hierarchyCandidates.length === 1 ? hierarchyCandidates[0].id : null,
      });
    }
    return { baseId, tables: out };
  }

  async query(
    baseId: string,
    ro: IBaseGraphQueryRo,
    ifNoneMatch?: string
  ): Promise<IBaseGraphQueryResult> {
    const plan = await this.resolver.resolve(baseId, ro);

    const probed = await this.etagService.probe(plan);
    if (probed) {
      if (ifNoneMatch === probed) {
        return { etag: probed, notModified: true };
      }
      const cached = await this.etagService.getCached(baseId, probed);
      if (cached) {
        return { etag: probed, notModified: false, vo: cached };
      }
    }

    const rows = await this.reader.read(plan);
    const graph = assembleBaseGraph(plan.assembler, rows);
    const etag = probed ?? this.etagService.payloadEtag(graph);
    const vo: IBaseGraphVo = { version: BASE_GRAPH_VERSION, etag, ...graph };

    if (probed) {
      await this.etagService.setCached(baseId, probed, vo, this.config.cacheTtlSeconds);
    }
    return { etag, notModified: ifNoneMatch === etag, vo };
  }

  /**
   * The planner's estimate for large tables, an exact count for small ones.
   * Postgres only; elsewhere, or on any failure, null — the picker shows no
   * count rather than a wrong one.
   */
  private async approxCount(dbTableName: string): Promise<number | null> {
    try {
      const client = this.dataPrismaService.txClient();
      let estimate = -1;
      if (this.dbProvider.driver === DriverClient.Pg) {
        const [schema, table] = this.dbProvider.splitTableName(dbTableName);
        const sql = this.knex('pg_class as c')
          .join('pg_namespace as ns', 'ns.oid', 'c.relnamespace')
          .where({ 'ns.nspname': schema, 'c.relname': table })
          .select(this.knex.raw('c.reltuples::bigint as n'))
          .toQuery();
        const [row] = await client.$queryRawUnsafe<{ n: bigint | number }[]>(sql);
        estimate = row ? Number(row.n) : -1;
      }
      if (estimate >= EXACT_COUNT_BELOW) {
        return estimate;
      }
      const sql = this.knex(dbTableName).count('* as n').toQuery();
      const [row] = await client.$queryRawUnsafe<{ n: bigint | number }[]>(sql);
      return row ? Number(row.n) : null;
    } catch (error) {
      this.logger.warn(`Row count for ${dbTableName} unavailable: ${String(error)}`);
      return null;
    }
  }
}
