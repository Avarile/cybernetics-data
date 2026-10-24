import type { FieldType, IFieldVo, ILinkFieldOptions } from '@cybernetics/core';
import {
  FieldKeyType,
  generateFieldId,
  HttpErrorCode,
  Relationship,
  ViewType,
} from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ISchemaPackAddOptions,
  ISchemaPackAddRo,
  ISchemaPackInstallRo,
  ISchemaPackInstallVo,
  ISchemaPackPlanRo,
  ISchemaPackPlanVo,
  SchemaPackId,
} from '@teable/openapi';
import { SCHEMA_PACK_CURRENCIES } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RedisNativeService } from '../../cache/redis-native.service';
import { CustomHttpException } from '../../custom.exception';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { BaseCreateEvent } from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { BaseService } from '../base/base.service';
import { FieldService } from '../field/field.service';
import { FieldOpenApiService } from '../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { TableOpenApiService } from '../table/open-api/table-open-api.service';
import { prepareCreateTableRo } from '../table/open-api/table.pipe.helper';
import { UserService } from '../user/user.service';
import { ViewOpenApiService } from '../view/open-api/view-open-api.service';
import type { ICatalogField } from './schema-pack.catalog';
import { getSchemaPackCatalog, linkTarget } from './schema-pack.catalog';
import { toFieldRo } from './schema-pack.field-ro';
import { SchemaPackInstallLock } from './schema-pack.lock';
import type { IInstallPlan } from './schema-pack.planner';
import { isSameField, planInstall, SchemaPackPlanError, toPlanVo } from './schema-pack.planner';

interface IExistingFieldRef {
  id: string;
  type: FieldType;
  isLookup?: boolean;
}

interface IExistingBase {
  tableIds: Map<string, string>;
  /** Fields by table name, then field name. */
  fields: Map<string, Map<string, IExistingFieldRef>>;
}

/** Where an install goes: a base it creates, or a base that already exists. */
type IInstallTarget =
  | { kind: 'new'; spaceId: string; name: string; icon?: string }
  | { kind: 'existing'; baseId: string; base: IExistingBase };

/** What one install created, so a failure can remove exactly that. */
interface IUndoLog {
  baseId?: string;
  tableIds: string[];
  fields: { tableId: string; fieldId: string }[];
}

/** Whether a link field holds many records: owners by their relationship, symmetric fields by its inverse. */
export const holdsMany = (field: ICatalogField, ownerRelationship: Relationship) => {
  const many = field.spec
    ? [Relationship.ManyMany, Relationship.OneMany]
    : [Relationship.ManyMany, Relationship.ManyOne];
  return many.includes(ownerRelationship);
};

/**
 * Access is checked by the routes: `base|create` on the space for a new base, and table, field
 * and record creation on the base when adding to one.
 */
@Injectable()
export class SchemaPackInstallerService {
  private readonly logger = new Logger(SchemaPackInstallerService.name);
  private readonly lock: SchemaPackInstallLock;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseService: BaseService,
    private readonly tableOpenApiService: TableOpenApiService,
    private readonly fieldService: FieldService,
    private readonly fieldOpenApiService: FieldOpenApiService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly viewOpenApiService: ViewOpenApiService,
    private readonly userService: UserService,
    private readonly eventEmitterService: EventEmitterService,
    redis: RedisNativeService,
    private readonly cls: ClsService<IClsStore>
  ) {
    this.lock = new SchemaPackInstallLock(redis, this.logger);
  }

  async plan(ro: ISchemaPackPlanRo, baseId?: string): Promise<ISchemaPackPlanVo> {
    const existing = baseId ? await this.loadBase(baseId) : undefined;
    const plan = this.makePlan(ro.packs, ro.optionalTables, ro.starterRows ?? true, existing);
    return toPlanVo(getSchemaPackCatalog(), plan);
  }

  async install(ro: ISchemaPackInstallRo): Promise<ISchemaPackInstallVo> {
    const target: IInstallTarget = {
      kind: 'new',
      spaceId: ro.spaceId,
      name: ro.options.baseName,
      icon: ro.options.icon,
    };
    const result = await this.run(target, ro.packs, ro.options, ro.completeOnboarding);
    this.emitBaseCreated(result.baseId, ro.options.baseName, ro.spaceId);
    return result;
  }

  /**
   * Installs into one base are serialised: two concurrent adds would both read the base before
   * either wrote to it, and create every table twice ("contacts", "contacts 2").
   */
  async addToBase(baseId: string, ro: ISchemaPackAddRo): Promise<ISchemaPackInstallVo> {
    await this.assertBaseExists(baseId);
    const release = await this.lock.acquire(baseId);
    try {
      const target: IInstallTarget = {
        kind: 'existing',
        baseId,
        base: await this.loadBase(baseId),
      };
      return await this.run(target, ro.packs, ro.options);
    } finally {
      await release();
    }
  }

  private async run(
    target: IInstallTarget,
    packs: SchemaPackId[],
    options: ISchemaPackAddOptions,
    completeOnboarding?: boolean
  ): Promise<ISchemaPackInstallVo> {
    const existing = target.kind === 'existing' ? target.base : undefined;
    const plan = this.makePlan(packs, options.optionalTables, options.starterRows, existing);
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
      const result = await this.execute(target, options, plan, undo);
      if (completeOnboarding) {
        await this.userService.updateOnboarding(this.cls.get('user.id'), 'completed');
      }
      return result;
    } catch (error) {
      await this.rollback(target.kind === 'existing' ? target.baseId : undefined, undo);
      throw error;
    }
  }

  private makePlan(
    packs: SchemaPackId[],
    optionalTables: string[],
    starterRows: boolean,
    existing?: IExistingBase
  ): IInstallPlan {
    const fields = existing
      ? new Map([...existing.fields].map(([table, byName]) => [table, new Map(byName)]))
      : undefined;
    try {
      return planInstall(getSchemaPackCatalog(), {
        packs,
        optionalTables,
        starterRows,
        existing: fields,
      });
    } catch (error) {
      if (error instanceof SchemaPackPlanError) {
        throw new CustomHttpException(error.message, HttpErrorCode.VALIDATION_ERROR);
      }
      throw error;
    }
  }

  private async assertBaseExists(baseId: string) {
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { id: true },
    });
    if (!base) throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND);
  }

  private async loadBase(baseId: string) {
    const tables = await this.tableOpenApiService.getTables(baseId);
    const existing: IExistingBase = { tableIds: new Map(), fields: new Map() };
    for (const table of tables) {
      const fields = await this.fieldOpenApiService.getFields(table.id, { filterHidden: false });
      existing.tableIds.set(table.name, table.id);
      existing.fields.set(
        table.name,
        new Map(fields.map((f) => [f.name, { id: f.id, type: f.type, isLookup: f.isLookup }]))
      );
    }
    return existing;
  }

  /** The interceptor-driven event would carry the install result, not the base, so emit it here. */
  private emitBaseCreated(id: string, name: string, spaceId: string) {
    const user = this.cls.get('user');
    const event = new BaseCreateEvent(
      { id, name, spaceId },
      { user: user && { id: user.id, name: user.name, email: user.email } }
    );
    void this.eventEmitterService.emitAsync(event.name, event);
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private async execute(
    target: IInstallTarget,
    options: ISchemaPackAddOptions,
    plan: IInstallPlan,
    undo: IUndoLog
  ): Promise<ISchemaPackInstallVo> {
    const catalog = getSchemaPackCatalog();
    const existing = target.kind === 'existing' ? target.base : undefined;
    const nameOf = (tableKey: string) => catalog.tables.get(tableKey)!.table.name;

    const tableIds = new Map<string, string>();
    const fieldIds = new Map<string, string>();
    for (const [key, { table, fields }] of catalog.tables) {
      const id = existing?.tableIds.get(table.name);
      if (!id) continue;
      tableIds.set(key, id);
      for (const field of fields.values()) {
        const found = existing!.fields.get(table.name)!.get(field.name);
        if (found && isSameField(field, found)) fieldIds.set(`${key}.${field.key}`, found.id);
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
      timezone: options.timezone,
      currencySymbol: SCHEMA_PACK_CURRENCIES[options.currency],
    };

    let baseId: string;
    if (target.kind === 'existing') {
      baseId = target.baseId;
    } else {
      const { spaceId, name, icon } = target;
      baseId = (await this.baseService.createBase({ spaceId, name, icon })).id;
      undo.baseId = baseId;
    }

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
        const foreign = linkTarget(catalog, field)!;
        const owner =
          field.spec ?? catalog.tables.get(foreign)!.fields.get(field.symmetricOf!.key)!.spec!;
        const ids = targets.map((t) => ({ id: recordIds.get(`${foreign}.${t}`)! }));
        fields[fieldId(table, key)] = holdsMany(field, owner.link!.relationship) ? ids : ids[0];
      }
      await this.recordOpenApiService.updateRecords(tableIds.get(table)!, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [{ id: recordId, fields }],
      });
    }
    return count;
  }

  /** Best effort: every step is attempted, and whatever could not be removed is logged. */
  private async rollback(targetBaseId: string | undefined, undo: IUndoLog) {
    const leftovers: string[] = [];
    const attempt = async (what: string, step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        leftovers.push(`${what} (${(error as Error).message})`);
      }
    };
    if (undo.baseId) {
      const baseId = undo.baseId;
      await attempt(`base ${baseId}`, () => this.baseService.permanentDeleteBase(baseId, true));
    } else {
      for (const { tableId, fieldId } of [...undo.fields].reverse()) {
        await attempt(`field ${tableId}/${fieldId}`, () =>
          this.fieldOpenApiService.deleteField(tableId, fieldId)
        );
      }
      if (targetBaseId && undo.tableIds.length) {
        await attempt(`tables ${undo.tableIds.join(', ')}`, () =>
          this.tableOpenApiService.permanentDeleteTables(targetBaseId, undo.tableIds)
        );
      }
    }
    if (leftovers.length) {
      this.logger.error(`Schema pack rollback incomplete, left behind: ${leftovers.join('; ')}`);
    }
  }
}
