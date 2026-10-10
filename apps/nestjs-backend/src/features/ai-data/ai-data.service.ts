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

export interface IAiDataQueryArgs {
  tableId: string;
  filter?: IGetRecordsRo['filter'];
  orderBy?: IGetRecordsRo['orderBy'];
  search?: string;
  /** Field ids to return. Omit for all fields. */
  projection?: string[];
  take?: number;
  skip?: number;
}

export interface IAiDataRecordsResult {
  records: IAiDataRecord[];
  returned: number;
  hasMore: boolean;
  nextSkip: number | null;
  /** True when a cell was cut or records were dropped to stay inside the size budget. */
  truncated: boolean;
}

export interface IAiDataTableSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface IAiDataFieldSummary {
  id: string;
  name: string;
  type: string;
  isPrimary: boolean;
  isComputed: boolean;
  /** Present for link fields and lookups. */
  linkedTableId?: string;
  /** Present for single/multiple select fields. */
  choices?: string[];
}

/**
 * Read-only data access for AI agents. Every call runs as the current user:
 * permissions are resolved from the CLS user, the table must belong to the
 * base the request is scoped to, and results are capped before they reach a model.
 *
 * Calls within one request are serialized. The services below read permissions
 * from CLS, so two calls interleaving across awaits could see each other's
 * permission set (the MCP registry documents the same constraint).
 */
@Injectable()
export class AiDataService {
  private readonly queues = new WeakMap<object, Promise<unknown>>();

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
      await this.authorize(baseId, ['table|read']);
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

  describeTable(baseId: string, tableId: string) {
    return this.serialize(async () => {
      await this.assertTableInBase(baseId, tableId);
      await this.authorize(tableId, ['table|read', 'field|read']);

      const [table, fields] = await Promise.all([
        this.tableService.getTable(baseId, tableId),
        this.fieldService.getFields(tableId, {}),
      ]);
      const { id, name, description } = table as {
        id: string;
        name: string;
        description?: string | null;
      };

      return {
        id,
        name,
        description: description ?? null,
        baseId,
        fields: (fields as unknown as IRawField[]).map((f) => this.toFieldSummary(f)),
      };
    });
  }

  queryRecords(baseId: string, args: IAiDataQueryArgs): Promise<IAiDataRecordsResult> {
    return this.serialize(async () => {
      await this.assertTableInBase(baseId, args.tableId);
      await this.authorize(args.tableId, ['record|read']);

      const take = Math.min(Math.max(args.take ?? 20, 1), this.config.maxRecordsPerCall);
      const skip = Math.max(args.skip ?? 0, 0);

      // Over-fetch by one to learn hasMore without a second count query.
      const result = (await this.recordService.getRecords(args.tableId, {
        take: take + 1,
        skip,
        filter: args.filter,
        orderBy: args.orderBy,
        search: args.search ? [args.search] : undefined,
        projection: args.projection,
        fieldKeyType: FieldKeyType.Id,
      } as never)) as { records: IAiDataRecord[] };

      const overFetched = result.records.length > take;
      const page = overFetched ? result.records.slice(0, take) : result.records;
      const capped = capRecords(page, this.config);

      const hasMore = overFetched || capped.droppedForSize > 0;
      return {
        records: capped.records,
        returned: capped.records.length,
        hasMore,
        nextSkip: hasMore ? skip + capped.records.length : null,
        truncated: capped.truncated,
      };
    });
  }

  /** Fetch specific records by id in one call. Ids that are not visible are reported, not guessed at. */
  getRecords(baseId: string, tableId: string, recordIds: string[]) {
    return this.serialize(async () => {
      await this.assertTableInBase(baseId, tableId);
      await this.authorize(tableId, ['record|read']);

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
        const result = (await this.recordService.getRecordsById(tableId, ids)) as {
          records: IAiDataRecord[];
        };
        found = result.records;
      } catch (error) {
        // getRecordsById throws NOT_FOUND when none of the ids resolve.
        if (!(error instanceof HttpException && error.getStatus() === 404)) throw error;
      }

      const capped = capRecords(found, this.config);
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

  private toFieldSummary(f: IRawField): IAiDataFieldSummary {
    const summary: IAiDataFieldSummary = {
      id: f.id,
      name: f.name,
      type: f.type,
      isPrimary: f.isPrimary ?? false,
      isComputed: f.isComputed ?? false,
    };
    const foreignTableId = f.options?.foreignTableId ?? f.lookupOptions?.foreignTableId;
    if (foreignTableId) summary.linkedTableId = foreignTableId;
    if (Array.isArray(f.options?.choices)) {
      summary.choices = f.options.choices.map((c) => c.name);
    }
    return summary;
  }

  private assertPrefix(id: string, prefix: IdPrefix, label: string) {
    if (typeof id !== 'string' || !id.startsWith(prefix)) {
      throw new CustomHttpException(
        `A ${label} must start with "${prefix}"`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
  }

  /**
   * The request is scoped to one base. A table id from another base gets the
   * same answer as one that does not exist, so ids cannot be probed.
   */
  private async assertTableInBase(baseId: string, tableId: string) {
    this.assertPrefix(baseId, IdPrefix.Base, 'base id');
    this.assertPrefix(tableId, IdPrefix.Table, 'table id');
    const notFound = () => new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND);
    let owner: { baseId: string };
    try {
      owner = await this.permissionService.getUpperIdByTableId(tableId);
    } catch {
      throw notFound();
    }
    if (owner.baseId !== baseId) throw notFound();
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

interface IRawField {
  id: string;
  name: string;
  type: string;
  isPrimary?: boolean;
  isComputed?: boolean;
  options?: { foreignTableId?: string; choices?: { name: string }[] };
  lookupOptions?: { foreignTableId?: string };
}
