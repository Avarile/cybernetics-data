import type { IFieldRo } from '@cybernetics/core';
import { FieldType } from '@cybernetics/core';
import type { ISchemaPackField } from '@teable/openapi';
import { SCHEMA_PACK_FORMULA_REF, SCHEMA_PACK_PLACEHOLDER } from '@teable/openapi';
import type { ISchemaPackCatalog } from './schema-pack.catalog';
import { linkTarget } from './schema-pack.catalog';

export interface IFieldRoContext {
  tableId: (tableKey: string) => string;
  fieldId: (tableKey: string, fieldKey: string) => string;
  timezone: string;
  currencySymbol: string;
}

const fill = (value: unknown, ctx: IFieldRoContext): unknown => {
  if (value === SCHEMA_PACK_PLACEHOLDER.timezone) return ctx.timezone;
  if (value === SCHEMA_PACK_PLACEHOLDER.currencySymbol) return ctx.currencySymbol;
  if (Array.isArray(value)) return value.map((v) => fill(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, ctx)]));
  }
  return value;
};

/** A pack field as the create-field API takes it, with every key resolved to an id. */
export const toFieldRo = (
  catalog: ISchemaPackCatalog,
  tableKey: string,
  spec: ISchemaPackField,
  ctx: IFieldRoContext
): IFieldRo => {
  const ro: Record<string, unknown> = {
    id: ctx.fieldId(tableKey, spec.key),
    name: spec.name,
    type: spec.type,
  };
  if (spec.description) ro.description = spec.description;

  if (spec.link) {
    const { table, relationship, isOneWay, lookupField } = spec.link;
    ro.options = {
      relationship,
      foreignTableId: ctx.tableId(table),
      ...(lookupField ? { lookupFieldId: ctx.fieldId(table, lookupField) } : {}),
      ...(isOneWay ? { isOneWay: true } : {}),
    };
    return ro as IFieldRo;
  }

  if (spec.lookup) {
    const link = catalog.tables.get(tableKey)!.fields.get(spec.lookup.link)!;
    const foreign = linkTarget(catalog, link)!;
    ro.lookupOptions = {
      foreignTableId: ctx.tableId(foreign),
      linkFieldId: ctx.fieldId(tableKey, spec.lookup.link),
      lookupFieldId: ctx.fieldId(foreign, spec.lookup.field),
    };
    if (spec.isLookup) {
      ro.isLookup = true;
      return ro as IFieldRo;
    }
  }

  const options = fill(spec.options ?? {}, ctx) as Record<string, unknown>;
  if (spec.type === FieldType.Formula) {
    options.expression = String(options.expression).replace(
      SCHEMA_PACK_FORMULA_REF,
      (_m, key: string) => `{${ctx.fieldId(tableKey, key)}}`
    );
  }
  if (Object.keys(options).length) ro.options = options;
  return ro as IFieldRo;
};
