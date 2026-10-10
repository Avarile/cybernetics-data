import { HttpException, Injectable } from '@nestjs/common';
import { FieldKeyType, HttpErrorCode, IdPrefix } from '@teable/core';
import type { Action } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { AiDataConfig, type IAiDataConfig } from '../../configs/ai-data.config';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordService } from '../record/record.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { capRecords } from './ai-data.limits';
import type { IAiDataRecord } from './ai-data.limits';
import {
  detectTableProfile,
  keyRecordsByName,
  resolveFieldRef,
  toFieldSummary,
  translateFilter,
  translateOrderBy,
  withSoftDeleteFilter,
} from './ai-data.schema';
import type { IAiDataFieldSummary, IAiDataTableProfile, IRawField } from './ai-data.schema';

export type { IAiDataFieldSummary, IAiDataTableProfile } from './ai-data.schema';

export type IAiDataFieldKeyType = 'id' | 'name';

export interface IAiDataQueryArgs {
  /** Table id (tblXXX) or exact table name. */
  tableId: string;
  /** Filter; fieldId may be a field id or a field name. */
  filter?: IGetRecordsRo['filter'];
  /** Sort; fieldId may be a field id or a field name. */
  orderBy?: IGetRecordsRo['orderBy'];
  search?: string;
  /** Field ids or names to return. Omit for all fields. */
  projection?: string[];
  take?: number;
  skip?: number;
  /** Key returned cells by field id (default) or by field name. */
  fieldKeyType?: IAiDataFieldKeyType;
  /** Also return soft-deleted rows (deleted_at set). Default false. */
  includeDeleted?: boolean;
}

export interface IAiDataRecordsResult {
  records: IAiDataRecord[];
  returned: number;
  hasMore: boolean;
  nextSkip: number | null;
  /** True when a cell was cut or records were dropped to stay inside the size budget. */
  truncated: boolean;
  /** True when soft-deleted rows were left out. */
  softDeletedExcluded: boolean;
}

export interface IAiDataTableSummary {
  id: string;
  name: string;
  description: string | null;
}

const schemaCacheTtlMs = 30_000;
const tableRead: Action = 'table|read';
const fieldRead: Action = 'field|read';
const recordRead: Action = 'record|read';

/**
 * Read-only data access for AI agents. Every call runs as the current user:
 * permissions are resolved from the CLS user, the table must belong to the
 * base the request is scoped to, and results are capped before they reach a model.
 * Tables and fields can be named by id or by name.
 *
 * Calls within one request are serialized. The services below read permissions
 * from CLS, so two calls interleaving across awaits could see each other's
 * permission set (the MCP registry documents the same constraint).
 */
@Injectable()
export class AiDataService {
  private readonly queues = new WeakMap<object, Promise<unknown>>();
  /** Table lists and field lists, per base / table. Only read after authorization. */
  private readonly schemaCache = new Map<string, { expires: number; value: unknown }>();

  constructor(
    @AiDataConfig() private readonly config: IAiDataConfig,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService,
    private readonly tableService: TableOpenApiService,
    private readonly fieldService: FieldOpenApiService,
    private readonly recordService: RecordService
  ) {}

  listTables(baseId: string): Promise<IAiDataTableSummary[]> {
    return this.serialize(async () => {
      this.assertPrefix(baseId, IdPrefix.Base, 'base id');
      await this.authorize(baseId, [tableRead]);
      return this.loadTables(baseId);
    });
  }

  describeTable(baseId: string, tableRef: string) {
    return this.serialize(async () => {
      const table = await this.resolveTable(baseId, tableRef);
      await this.authorize(table.id, [tableRead, fieldRead]);
      const fields = await this.loadFields(table.id);
      return {
        ...table,
        baseId,
        profile: detectTableProfile(fields) as IAiDataTableProfile,
        fields,
      };
    });
  }

  queryRecords(baseId: string, args: IAiDataQueryArgs): Promise<IAiDataRecordsResult> {
    return this.serialize(async () => {
      const table = await this.resolveTable(baseId, args.tableId);
      await this.authorize(table.id, [recordRead, fieldRead]);
      const fields = await this.loadFields(table.id);
      const { softDeleteFieldId } = detectTableProfile(fields);

      let filter = args.filter ? translateFilter(args.filter, fields, table.name) : undefined;
      const excludeDeleted = Boolean(softDeleteFieldId && !args.includeDeleted);
      if (excludeDeleted) filter = withSoftDeleteFilter(filter, softDeleteFieldId as string);

      const take = Math.min(Math.max(args.take ?? 20, 1), this.config.maxRecordsPerCall);
      const skip = Math.max(args.skip ?? 0, 0);

      // Over-fetch by one to learn hasMore without a second count query.
      const result = (await this.recordService.getRecords(table.id, {
        take: take + 1,
        skip,
        filter,
        orderBy: args.orderBy ? translateOrderBy(args.orderBy, fields, table.name) : undefined,
        search: args.search ? [args.search] : undefined,
        projection: args.projection?.map((ref) => resolveFieldRef(ref, fields, table.name)),
        fieldKeyType: FieldKeyType.Id,
      } as never)) as { records: IAiDataRecord[] };

      const overFetched = result.records.length > take;
      const page = overFetched ? result.records.slice(0, take) : result.records;
      const keyed = args.fieldKeyType === 'name' ? keyRecordsByName(page, fields) : page;
      const capped = capRecords(keyed, this.config);

      const hasMore = overFetched || capped.droppedForSize > 0;
      return {
        records: capped.records,
        returned: capped.records.length,
        hasMore,
        nextSkip: hasMore ? skip + capped.records.length : null,
        truncated: capped.truncated,
        softDeletedExcluded: excludeDeleted,
      };
    });
  }

  /** Fetch specific records by id in one call. Ids that are not visible are reported, not guessed at. */
  getRecords(
    baseId: string,
    tableRef: string,
    recordIds: string[],
    options: { fieldKeyType?: IAiDataFieldKeyType } = {}
  ) {
    return this.serialize(async () => {
      const table = await this.resolveTable(baseId, tableRef);
      await this.authorize(table.id, [recordRead, fieldRead]);

      const ids = [...new Set(recordIds)];
      if (ids.length === 0) {
        throw new CustomHttpException(
          'recordIds must not be empty',
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      if (ids.length > this.config.maxRecordsPerCall) {
        throw new CustomHttpException(
          `Too many record ids: ${ids.length}. Ask for at most ${this.config.maxRecordsPerCall} per call.`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }

      let found: IAiDataRecord[] = [];
      try {
        const result = (await this.recordService.getRecordsById(table.id, ids)) as {
          records: IAiDataRecord[];
        };
        found = result.records;
      } catch (error) {
        // getRecordsById throws NOT_FOUND when none of the ids resolve.
        if (!(error instanceof HttpException && error.getStatus() === 404)) throw error;
      }

      const keyed =
        options.fieldKeyType === 'name'
          ? keyRecordsByName(found, await this.loadFields(table.id))
          : found;
      const capped = capRecords(keyed, this.config);
      const seen = new Set(capped.records.map((r) => r.id));
      const foundIds = new Set(found.map((r) => r.id));
      return {
        records: capped.records,
        returned: capped.records.length,
        missingIds: ids.filter((id) => !foundIds.has(id)),
        notReturnedForSize: found.filter((r) => !seen.has(r.id)).map((r) => r.id),
        truncated: capped.truncated,
      };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private assertPrefix(id: string, prefix: IdPrefix, label: string) {
    if (typeof id !== 'string' || !id.startsWith(prefix)) {
      throw new CustomHttpException(
        `A ${label} must start with "${prefix}"`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
  }

  /**
   * Find a table of the request's base by id or exact name (case-insensitive if that
   * is unambiguous). The base is checked first, so table names of a base the user
   * cannot read are never revealed. A table from another base gets the same
   * "Table not found" as one that does not exist, so ids cannot be probed.
   */
  private async resolveTable(baseId: string, tableRef: string): Promise<IAiDataTableSummary> {
    this.assertPrefix(baseId, IdPrefix.Base, 'base id');
    if (typeof tableRef !== 'string' || !tableRef.trim()) {
      throw new CustomHttpException(
        'A table id or name is required',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    await this.authorize(baseId, [tableRead]);
    const tables = await this.loadTables(baseId);
    const ref = tableRef.trim();
    const match =
      tables.find((t) => t.id === ref) ??
      tables.find((t) => t.name === ref) ??
      (() => {
        const loose = tables.filter((t) => t.name.toLowerCase() === ref.toLowerCase());
        return loose.length === 1 ? loose[0] : undefined;
      })();
    if (!match) throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND);
    return match;
  }

  private loadTables(baseId: string): Promise<IAiDataTableSummary[]> {
    return this.cached(`tables:${baseId}`, async () => {
      const tables = (await this.tableService.getTables(baseId)) as {
        id: string;
        name: string;
        description?: string | null;
      }[];
      return tables.map(({ id, name, description }) => ({
        id,
        name,
        description: description ?? null,
      }));
    });
  }

  private loadFields(tableId: string): Promise<IAiDataFieldSummary[]> {
    return this.cached(`fields:${tableId}`, async () => {
      const fields = await this.fieldService.getFields(tableId, {});
      return (fields as unknown as IRawField[]).map(toFieldSummary);
    });
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.schemaCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    const value = await load();
    this.schemaCache.set(key, { expires: Date.now() + schemaCacheTtlMs, value });
    return value;
  }

  /** Check the actions for this resource and publish the result to CLS, as the MCP registry does. */
  private async authorize(resourceId: string, actions: Action[]) {
    const accessTokenId = this.cls.get('accessTokenId');
    const permissions = await this.permissionService.validPermissions(
      resourceId,
      actions,
      accessTokenId
    );
    this.cls.set('permissions', permissions);
  }

  /** Run `task` after every earlier call of the same request has settled. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const store = (this.cls as unknown as { get(): unknown }).get();
    if (!store || typeof store !== 'object') return task();

    const tail = this.queues.get(store) ?? Promise.resolve();
    const run = tail.then(task, task);
    this.queues.set(
      store,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }
}
