import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Action, IFieldVo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, generateFieldId, HttpErrorCode, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISchemaPackInstallRo,
  ISchemaPackInstallVo,
  ISchemaPackPlanRo,
  ISchemaPackPlanVo,
} from '@teable/openapi';
import { SCHEMA_PACK_CURRENCIES } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RedisNativeService } from '../../cache/redis-native.service';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { BaseService } from '../base/base.service';
import { FieldService } from '../field/field.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { prepareCreateTableRo } from '../table/open-api/table.pipe.helper';
import { UserService } from '../user/user.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import { getSchemaPackCatalog } from './schema-pack.catalog';
import { toFieldRo } from './schema-pack.field-ro';
import type { IInstallPlan } from './schema-pack.planner';
import { planInstall, SchemaPackPlanError, toPlanVo } from './schema-pack.planner';

// eslint-disable-next-line @typescript-eslint/naming-convention
const INSTALL_LOCK_TTL_SECONDS = 300;
/** Same-process guard; the Redis lock covers other instances when Redis is the cache provider. */
const basesBeingInstalled = new Set<string>();
// eslint-disable-next-line @typescript-eslint/naming-convention
const INSTALL_ACTIONS: Action[] = ['table|create', 'field|create', 'record|create'];

interface IExistingBase {
  tableIds: Map<string, string>;
  /** Field ids by table name, then field name. */
  fields: Map<string, Map<string, string>>;
}

/** What one install created, so a failure can remove exactly that. */
interface IUndoLog {
  baseId?: string;
  tableIds: string[];
  fields: { tableId: string; fieldId: string }[];
}

@Injectable()
export class SchemaPackInstallerService {
  private readonly logger = new Logger(SchemaPackInstallerService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly baseService: BaseService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly userService: UserService,
    private readonly redis: RedisNativeService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async plan(ro: ISchemaPackPlanRo): Promise<ISchemaPackPlanVo> {
    const existing = ro.baseId ? await this.readBase(ro.baseId, ['base|read']) : undefined;
    const catalog = getSchemaPackCatalog();
    const plan = this.makePlan({ ...ro, starterRows: ro.starterRows ?? true }, existing);
    return toPlanVo(catalog, plan);
  }

  /**
   * Installs into one base are serialised: two concurrent adds would both read the base before
   * either wrote to it, and create every table twice ("contacts", "contacts 2").
   */
  async install(ro: ISchemaPackInstallRo): Promise<ISchemaPackInstallVo> {
    if (!ro.baseId) return await this.installUnlocked(ro);
    // Access first: a caller without rights must get 403, and must not be able to hold the lock.
    await this.assertBaseAccess(ro.baseId, INSTALL_ACTIONS, ro.spaceId);
    const release = await this.lockBase(ro.baseId);
    try {
      return await this.installUnlocked(ro, await this.loadBase(ro.baseId));
    } finally {
      await release();
    }
  }

  private async lockBase(baseId: string) {
    const busy = () =>
      new CustomHttpException(
        'Schema packs are already being added to this base; try again shortly',
        HttpErrorCode.CONFLICT
      );
    if (basesBeingInstalled.has(baseId)) throw busy();
    basesBeingInstalled.add(baseId);
    const key = `schema-pack:install-lock:${baseId}`;
    const token = randomUUID();
    let viaRedis = false;
    try {
      if (!(await this.redis.setnxex(key, INSTALL_LOCK_TTL_SECONDS, token))) {
        basesBeingInstalled.delete(baseId);
        throw busy();
      }
      viaRedis = true;
    } catch (error) {
      if (error instanceof CustomHttpException) throw error;
      // No Redis (memory cache, single process): the in-process guard is the lock.
      this.logger.debug(`Schema pack install lock without Redis: ${(error as Error).message}`);
    }
    return async () => {
      basesBeingInstalled.delete(baseId);
      if (!viaRedis) return;
      try {
        if ((await this.redis.get(key)) === token) await this.redis.del(key);
      } catch {
        // The TTL frees it.
      }
    };
  }

  private async installUnlocked(
    ro: ISchemaPackInstallRo,
    existing?: IExistingBase
  ): Promise<ISchemaPackInstallVo> {
    const plan = this.makePlan(
      {
        packs: ro.packs,
        optionalTables: ro.options.optionalTables,
        starterRows: ro.options.starterRows,
      },
      existing
    );
    const createsSomething =
      plan.tables.some((t) => !t.existing || t.fields.length) ||
      plan.links.length > 0 ||
      plan.computed.length > 0;
    if (!createsSomething) {
      throw new CustomHttpException(
        'These packs are already in the base',
        HttpErrorCode.VALIDATION_ERROR
      );
    }

    const undo: IUndoLog = { tableIds: [], fields: [] };
    try {
      const result = await this.execute(ro, plan, existing, undo);
      if (ro.completeOnboarding) {
        await this.userService.updateOnboarding(this.cls.get('user.id'), 'completed');
      }
      return result;
    } catch (error) {
      await this.rollback(ro.baseId, undo);
      throw error;
    }
  }

  private makePlan(
    input: { packs: ISchemaPackPlanRo['packs']; optionalTables: string[]; starterRows: boolean },
    existing?: IExistingBase
  ): IInstallPlan {
    const names = existing
      ? new Map([...existing.fields].map(([table, fields]) => [table, new Set(fields.keys())]))
      : undefined;
    try {
      return planInstall(getSchemaPackCatalog(), { ...input, existing: names });
    } catch (error) {
      if (error instanceof SchemaPackPlanError) {
        throw new CustomHttpException(error.message, HttpErrorCode.VALIDATION_ERROR);
      }
      throw error;
    }
  }

  private async readBase(baseId: string, actions: Action[], spaceId?: string) {
    await this.assertBaseAccess(baseId, actions, spaceId);
    return await this.loadBase(baseId);
  }

  private async assertBaseAccess(baseId: string, actions: Action[], spaceId?: string) {
    const accessTokenId = this.cls.get('accessTokenId');
    await this.permissionService.validPermissions(baseId, actions);
    if (accessTokenId) {
      await this.permissionService.validPermissions(baseId, actions, accessTokenId);
    }
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true },
    });
    if (!base || (spaceId && base.spaceId !== spaceId)) {
      throw new CustomHttpException('Base not found in this space', HttpErrorCode.NOT_FOUND);
    }
  }

  private async loadBase(baseId: string) {
    const tables = await this.tableOpenApiService.getTables(baseId);
    const existing: IExistingBase = { tableIds: new Map(), fields: new Map() };
    for (const table of tables) {
      const fields = await this.fieldOpenApiService.getFields(table.id, { filterHidden: false });
      existing.tableIds.set(table.name, table.id);
      existing.fields.set(table.name, new Map(fields.map((f) => [f.name, f.id])));
    }
    return existing;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async execute(
    ro: ISchemaPackInstallRo,
    plan: IInstallPlan,
    existing: IExistingBase | undefined,
    undo: IUndoLog
  ): Promise<ISchemaPackInstallVo> {
    const catalog = getSchemaPackCatalog();
    const nameOf = (tableKey: string) => catalog.tables.get(tableKey)!.table.name;

    const tableIds = new Map<string, string>();
    const fieldIds = new Map<string, string>();
    for (const [key, { table, fields }] of catalog.tables) {
      const id = existing?.tableIds.get(table.name);
      if (!id) continue;
      tableIds.set(key, id);
      for (const field of fields.values()) {
        const fieldId = existing!.fields.get(table.name)!.get(field.name);
        if (fieldId) fieldIds.set(`${key}.${field.key}`, fieldId);
      }
    }
    const allPlanned = [
      ...plan.tables.flatMap((t) => t.fields.map((spec) => ({ table: t.key, spec }))),
      ...plan.links,
      ...plan.computed,
    ];
    allPlanned.forEach(({ table, spec }) =>
      fieldIds.set(`${table}.${spec.key}`, generateFieldId())
    );

    const ctx = {
      tableId: (key: string) => tableIds.get(key)!,
      fieldId: (table: string, key: string) => {
        const id = fieldIds.get(`${table}.${key}`);
        if (!id) throw new Error(`Schema pack: no id for ${table}.${key}`);
        return id;
      },
      timezone: ro.options.timezone,
      currencySymbol: SCHEMA_PACK_CURRENCIES[ro.options.currency],
    };

    const baseId =
      ro.baseId ??
      (
        await this.baseService.createBase({
          spaceId: ro.spaceId,
          name: ro.options.baseName,
          icon: ro.options.icon,
        })
      ).id;
    if (!ro.baseId) undo.baseId = baseId;

    let fieldCount = 0;
    for (const table of plan.tables) {
      const fieldRos = table.fields
        .slice()
        .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)))
        .map((spec) => toFieldRo(catalog, table.key, spec, ctx));
      if (table.existing) {
        const tableId = tableIds.get(table.key)!;
        for (const fieldRo of fieldRos) {
          await this.fieldOpenApiService.createField(tableId, fieldRo);
          undo.fields.push({ tableId, fieldId: fieldRo.id! });
        }
      } else {
        const created = await this.tableOpenApiService.createTable(
          baseId,
          prepareCreateTableRo({
            name: table.name,
            icon: table.icon ?? null,
            description: null,
            fieldKeyType: FieldKeyType.Id,
            fields: fieldRos,
            records: [],
          })
        );
        tableIds.set(table.key, created.id);
        undo.tableIds.push(created.id);
      }
      fieldCount += fieldRos.length;
    }

    const isNewTable = (key: string) => plan.tables.some((t) => t.key === key && !t.existing);
    const trackField = (tableKey: string, fieldId: string) => {
      fieldCount++;
      if (!isNewTable(tableKey)) undo.fields.push({ tableId: tableIds.get(tableKey)!, fieldId });
    };

    for (const { table, spec } of plan.links) {
      const tableId = tableIds.get(table)!;
      const field = (await this.fieldOpenApiService.createField(
        tableId,
        toFieldRo(catalog, table, spec, ctx)
      )) as IFieldVo;
      trackField(table, field.id);
      const symmetric = spec.link!.symmetric;
      const symmetricId = (field.options as ILinkFieldOptions).symmetricFieldId;
      if (symmetric && symmetricId) {
        const foreign = spec.link!.table;
        fieldIds.set(`${foreign}.${symmetric.key}`, symmetricId);
        trackField(foreign, symmetricId);
        const foreignTableId = tableIds.get(foreign)!;
        const generated = await this.fieldService.getField(foreignTableId, symmetricId);
        if (generated.name !== symmetric.name) {
          await this.fieldOpenApiService.updateField(foreignTableId, symmetricId, {
            name: symmetric.name,
          });
        }
      }
    }

    for (const { table, spec } of plan.computed) {
      const tableId = tableIds.get(table)!;
      await this.fieldOpenApiService.createField(tableId, toFieldRo(catalog, table, spec, ctx));
      trackField(table, ctx.fieldId(table, spec.key));
    }

    for (const table of plan.tables) {
      for (const view of table.views) {
        await this.viewOpenApiService.createView(tableIds.get(table.key)!, {
          name: view.name,
          type: view.type as ViewType,
          ...(view.type === ViewType.Kanban && view.stackField
            ? { options: { stackFieldId: ctx.fieldId(table.key, view.stackField) } }
            : {}),
        });
      }
    }

    const records = await this.insertSeeds(plan, tableIds, ctx.fieldId);
    return {
      baseId,
      tables: plan.tables
        .filter((t) => !t.existing)
        .map((t) => ({ key: t.key, id: tableIds.get(t.key)!, name: nameOf(t.key) })),
      counts: {
        tables: plan.tables.filter((t) => !t.existing).length,
        fields: fieldCount,
        records,
      },
    };
  }

  /** Rows first, links second, so a row can link to one inserted after it (or to itself). */
  private async insertSeeds(
    plan: IInstallPlan,
    tableIds: Map<string, string>,
    fieldId: (table: string, key: string) => string
  ) {
    const recordIds = new Map<string, string>();
    let count = 0;
    const linkUpdates: { table: string; recordId: string; links: Record<string, string[]> }[] = [];
    for (const { table, rows } of plan.seeds) {
      const { records } = await this.recordOpenApiService.createRecords(tableIds.get(table)!, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: rows.map((row) => ({
          fields: Object.fromEntries(
            Object.entries(row.fields).map(([key, value]) => [fieldId(table, key), value])
          ),
        })),
      });
      rows.forEach((row, i) => {
        if (row.key) recordIds.set(`${table}.${row.key}`, records[i].id);
        if (Object.keys(row.links).length) {
          linkUpdates.push({ table, recordId: records[i].id, links: row.links });
        }
      });
      count += records.length;
    }
    const catalog = getSchemaPackCatalog();
    for (const { table, recordId, links } of linkUpdates) {
      const fields: Record<string, unknown> = {};
      for (const [key, targets] of Object.entries(links)) {
        const field = catalog.tables.get(table)!.fields.get(key)!;
        const foreign = field.spec?.link?.table ?? field.symmetricOf!.table;
        const ids = targets.map((t) => ({ id: recordIds.get(`${foreign}.${t}`)! }));
        const many = ['manyMany', 'oneMany'].includes(field.spec?.link?.relationship ?? 'oneMany');
        fields[fieldId(table, key)] = many ? ids : ids[0];
      }
      await this.recordOpenApiService.updateRecords(tableIds.get(table)!, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [{ id: recordId, fields }],
      });
    }
    return count;
  }

  private async rollback(targetBaseId: string | undefined, undo: IUndoLog) {
    try {
      if (undo.baseId) {
        await this.baseService.permanentDeleteBase(undo.baseId, true);
        return;
      }
      for (const { tableId, fieldId } of undo.fields.reverse()) {
        await this.fieldOpenApiService.deleteField(tableId, fieldId).catch(() => undefined);
      }
      if (targetBaseId && undo.tableIds.length) {
        await this.tableOpenApiService.permanentDeleteTables(targetBaseId, undo.tableIds);
      }
    } catch (error) {
      this.logger.error(`Schema pack rollback incomplete: ${(error as Error).message}`);
    }
  }
}
