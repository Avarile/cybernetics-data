import { CellFormat, FieldKeyType } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IRecord } from '@teable/openapi';
import { AggregationOpenApiService } from '../../../aggregation/open-api/aggregation-open-api.service';
import { PermissionService } from '../../../auth/permission.service';
import { BaseService } from '../../../base/base.service';
import { RecordService } from '../../../record/record.service';
import type { ICockpitDataPort, ICockpitRecordRow } from '../../domain/ports';
import { SearchTables } from '../knowledge/search-tables';

/** A cell in the text format is a string; anything else is shown as JSON. */
const textOf = (value: unknown) =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

const rowOf = (record: IRecord): ICockpitRecordRow => ({
  id: record.id,
  cells: Object.fromEntries(Object.entries(record.fields).map(([k, v]) => [k, textOf(v)])),
  ...(record.lastModifiedTime || record.createdTime
    ? { lastModifiedTime: record.lastModifiedTime ?? record.createdTime }
    : {}),
});

/**
 * Scope design §10: bases, tables and records for the cockpit, read as the admin through the
 * same services as the app (the grid's record queries, its search count, its permissions).
 */
@Injectable()
export class CockpitDataReader implements ICockpitDataPort {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseService: BaseService,
    private readonly permissions: PermissionService,
    private readonly records: RecordService,
    private readonly aggregation: AggregationOpenApiService,
    private readonly searchTables: SearchTables
  ) {}

  private async agentSpaceId() {
    return (await this.searchTables.currentSettings())?.agentSpaceId ?? null;
  }

  async listBases() {
    const agentSpaceId = await this.agentSpaceId();
    const bases = (await this.baseService.getAllBaseList()).filter(
      (b) => b.spaceId !== agentSpaceId
    );
    const spaces = await this.prismaService.space.findMany({
      where: { id: { in: [...new Set(bases.map((b) => b.spaceId))] } },
      select: { id: true, name: true },
    });
    const spaceName = new Map(spaces.map((s) => [s.id, s.name]));
    return bases.map((b) => ({
      id: b.id,
      name: b.name,
      spaceId: b.spaceId,
      spaceName: spaceName.get(b.spaceId) ?? '',
    }));
  }

  async base(baseId: string) {
    const agentSpaceId = await this.agentSpaceId();
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null, space: { deletedTime: null } },
      select: { id: true, name: true, spaceId: true },
    });
    return base && base.spaceId !== agentSpaceId ? { id: base.id, name: base.name } : undefined;
  }

  async table(tableId: string) {
    const meta = await this.prismaService.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { id: true, name: true, baseId: true },
    });
    return meta && (await this.base(meta.baseId)) ? meta : undefined;
  }

  async assertAllowed(baseId: string, permissions: ('table|read' | 'record|read')[]) {
    await this.permissions.validPermissions(baseId, permissions);
  }

  async search(tableId: string, q: string, take: number) {
    // the table page's global search, table-wide: every field, matching rows only
    const search: [string, string, boolean] = [q, '', true];
    const [{ records }, count] = await Promise.all([
      this.records.getRecords(tableId, {
        search,
        ignoreViewQuery: true,
        take,
        fieldKeyType: FieldKeyType.Id,
        cellFormat: CellFormat.Text,
      }),
      this.aggregation.getSearchCount(tableId, { search, ignoreViewQuery: true }),
    ]);
    return { records: records.map(rowOf), total: count.count };
  }

  async readRecord(tableId: string, recordId: string) {
    const [snapshot] = await this.records.getSnapshotBulkWithPermission(
      tableId,
      [recordId],
      undefined,
      FieldKeyType.Id,
      CellFormat.Text
    );
    if (!snapshot?.data) return undefined;
    return rowOf(snapshot.data);
  }
}
