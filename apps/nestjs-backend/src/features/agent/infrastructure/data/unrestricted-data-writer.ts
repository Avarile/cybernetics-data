import { FieldKeyType, HttpErrorCode } from '@cybernetics/core';
import type { IFieldRo } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../../../custom.exception';
import { resolveFieldRef } from '../../../ai-data/ai-data.schema';
import type { IAiDataFieldSummary } from '../../../ai-data/ai-data.schema';
import { AiDataService } from '../../../ai-data/ai-data.service';
import { FieldOpenApiService } from '../../../field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../../../record/open-api/record-open-api.service';
import { TableOpenApiService } from '../../../table/open-api/table-open-api.service';
import { prepareCreateTableRo } from '../../../table/open-api/table.pipe.helper';
import type { IDataFieldSpec, IDataTableRef } from '../../domain/ports';

/**
 * Writes for the DataGatewayPort (design §8 data_write and schema). Tables and fields are
 * resolved fresh from the database (not the 30 s schema cache), and the cache is cleared after a
 * schema change so the next read sees it. Deletes go to Teable's trash.
 */
@Injectable()
export class UnrestrictedDataWriter {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly aiData: AiDataService,
    private readonly records: RecordOpenApiService,
    private readonly tables: TableOpenApiService,
    private readonly fields: FieldOpenApiService
  ) {}

  /** The table of this base by id or exact name, with its fields. */
  async resolve({ baseId, table }: IDataTableRef) {
    const tables = await this.prismaService.tableMeta.findMany({
      where: { baseId, deletedTime: null },
      select: { id: true, name: true },
    });
    const found =
      tables.find((t) => t.id === table) ??
      tables.find((t) => t.name === table) ??
      (() => {
        const loose = tables.filter((t) => t.name.toLowerCase() === table.toLowerCase());
        return loose.length === 1 ? loose[0] : undefined;
      })();
    if (!found) throw new CustomHttpException('Table not found', HttpErrorCode.NOT_FOUND);
    const fields = await this.prismaService.field.findMany({
      where: { tableId: found.id, deletedTime: null },
      select: { id: true, name: true, type: true, isPrimary: true, isComputed: true },
    });
    return {
      ...found,
      fields: fields.map(
        (f): IAiDataFieldSummary => ({
          id: f.id,
          name: f.name,
          type: f.type,
          isPrimary: Boolean(f.isPrimary),
          isComputed: Boolean(f.isComputed),
        })
      ),
    };
  }

  async createRecords(ref: IDataTableRef & { records: Record<string, unknown>[] }) {
    const t = await this.resolve(ref);
    const created = await this.records.createRecords(t.id, {
      fieldKeyType: FieldKeyType.Name,
      typecast: true,
      records: ref.records.map((fields) => ({ fields })),
    });
    return { table: t.name, created: created.records.map((r) => r.id) };
  }

  async updateRecords(
    ref: IDataTableRef & { records: { id: string; fields: Record<string, unknown> }[] }
  ) {
    const t = await this.resolve(ref);
    await this.records.updateRecords(t.id, {
      fieldKeyType: FieldKeyType.Name,
      typecast: true,
      records: ref.records,
    });
    return { table: t.name, updated: ref.records.map((r) => r.id) };
  }

  async deleteRecords(ref: IDataTableRef & { recordIds: string[] }) {
    const t = await this.resolve(ref);
    await this.records.deleteRecords(t.id, ref.recordIds);
    return {
      table: t.name,
      deleted: ref.recordIds,
      note: 'Moved to the trash; it can be restored.',
    };
  }

  async createTable(input: { baseId: string; name: string; fields: IDataFieldSpec[] }) {
    // the same defaults (primary field, grid view) the table route applies
    const table = await this.tables.createTable(
      input.baseId,
      prepareCreateTableRo({ name: input.name, fields: input.fields as IFieldRo[] })
    );
    this.aiData.invalidate(input.baseId);
    const created = await this.resolve({ baseId: input.baseId, table: table.id });
    return {
      id: created.id,
      name: created.name,
      fields: created.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    };
  }

  async createField(ref: IDataTableRef & { field: IDataFieldSpec }) {
    const t = await this.resolve(ref);
    const field = await this.fields.createField(t.id, ref.field as IFieldRo);
    this.aiData.invalidate(ref.baseId, t.id);
    return { table: t.name, id: field.id, name: field.name, type: field.type };
  }

  /** Rename or describe a field; a new type or new options convert it. */
  async updateField(ref: IDataTableRef & { field: string; patch: Partial<IDataFieldSpec> }) {
    const t = await this.resolve(ref);
    const fieldId = resolveFieldRef(ref.field, t.fields, t.name);
    const current = t.fields.find((f) => f.id === fieldId)!;
    const { type, options, name, description } = ref.patch;
    const result =
      type || options
        ? await this.fields.convertField(t.id, fieldId, {
            type: type ?? current.type,
            ...(options ? { options } : {}),
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
          } as never)
        : await this.fields.updateField(t.id, fieldId, { name, description } as never);
    this.aiData.invalidate(ref.baseId, t.id);
    const vo = (result ?? {}) as { id?: string; name?: string; type?: string };
    return {
      table: t.name,
      id: vo.id ?? fieldId,
      name: vo.name ?? name ?? current.name,
      type: vo.type ?? type ?? current.type,
    };
  }

  async deleteField(ref: IDataTableRef & { field: string }) {
    const t = await this.resolve(ref);
    const fieldId = resolveFieldRef(ref.field, t.fields, t.name);
    await this.fields.deleteField(t.id, fieldId);
    this.aiData.invalidate(ref.baseId, t.id);
    return { table: t.name, deleted: fieldId };
  }

  async deleteTable(ref: IDataTableRef) {
    const t = await this.resolve(ref);
    await this.tables.deleteTable(ref.baseId, t.id);
    this.aiData.invalidate(ref.baseId, t.id);
    return { deleted: t.id, name: t.name, note: 'Moved to the trash; it can be restored.' };
  }
}
