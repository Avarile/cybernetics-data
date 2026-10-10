import { HttpErrorCode } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import type { IAiDataRecord } from './ai-data.limits';

/**
 * Pure helpers that let agents talk about tables and fields by name, and that
 * read the template convention the knowledge tables follow (title, context,
 * is_active, deleted_at). Nothing here is hardcoded per table: the schema evolves,
 * so everything is derived from the live field list.
 */

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

export interface IRawField {
  id: string;
  name: string;
  type: string;
  isPrimary?: boolean;
  isComputed?: boolean;
  options?: { foreignTableId?: string; choices?: { name: string }[] };
  lookupOptions?: { foreignTableId?: string };
}

/** Roles some fields play, detected from the field list. */
export interface IAiDataTableProfile {
  /** The primary field, used as the record's title. */
  titleFieldId?: string;
  /** A long text field named "context", the record's main body in the knowledge tables. */
  contextFieldId?: string;
  /** A date field named "deleted_at"; a value means the record is soft-deleted. */
  softDeleteFieldId?: string;
}

type IFilter = NonNullable<IGetRecordsRo['filter']>;
type IOrderBy = NonNullable<IGetRecordsRo['orderBy']>;

export function toFieldSummary(f: IRawField): IAiDataFieldSummary {
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

const named = (fields: IAiDataFieldSummary[], name: string, types: string[]) =>
  fields.find((f) => f.name.toLowerCase() === name && types.includes(f.type) && !f.isComputed);

export function detectTableProfile(fields: IAiDataFieldSummary[]): IAiDataTableProfile {
  const profile: IAiDataTableProfile = {};
  const title = fields.find((f) => f.isPrimary);
  if (title) profile.titleFieldId = title.id;
  const context = named(fields, 'context', ['longText', 'singleLineText']);
  if (context) profile.contextFieldId = context.id;
  const deletedAt = named(fields, 'deleted_at', ['date']);
  if (deletedAt) profile.softDeleteFieldId = deletedAt.id;
  return profile;
}

/**
 * Resolve a field reference (id or name) to a field id. Exact id first, then exact
 * name, then a case-insensitive name that matches exactly one field.
 */
export function resolveFieldRef(
  ref: string,
  fields: IAiDataFieldSummary[],
  tableName: string
): string {
  const byId = fields.find((f) => f.id === ref);
  if (byId) return byId.id;
  const byName = fields.find((f) => f.name === ref);
  if (byName) return byName.id;
  const loose = fields.filter((f) => f.name.toLowerCase() === ref.toLowerCase());
  if (loose.length === 1) return loose[0].id;

  const known = fields.map((f) => f.name).join(', ');
  throw new CustomHttpException(
    `Unknown field "${ref}" in table "${tableName}". Fields: ${known.slice(0, 1000)}`,
    HttpErrorCode.VALIDATION_ERROR
  );
}

/** Rewrite every field reference in a filter tree (items and field-valued operands) to ids. */
export function translateFilter(
  filter: IFilter,
  fields: IAiDataFieldSummary[],
  tableName: string
): IFilter {
  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.filterSet)) return { ...n, filterSet: n.filterSet.map(walk) };
    const out: Record<string, unknown> = { ...n };
    if (typeof n.fieldId === 'string') out.fieldId = resolveFieldRef(n.fieldId, fields, tableName);
    const value = n.value as Record<string, unknown> | undefined;
    if (value && typeof value === 'object' && typeof value.fieldId === 'string') {
      out.value = { ...value, fieldId: resolveFieldRef(value.fieldId, fields, tableName) };
    }
    return out;
  };
  return walk(filter) as IFilter;
}

export function translateOrderBy(
  orderBy: IOrderBy,
  fields: IAiDataFieldSummary[],
  tableName: string
): IOrderBy {
  return orderBy.map((item) => ({
    ...item,
    fieldId: resolveFieldRef(item.fieldId, fields, tableName),
  }));
}

/** AND a "deleted_at is empty" condition onto the caller's filter. */
export function withSoftDeleteFilter(
  filter: IFilter | undefined | null,
  softDeleteFieldId: string
): IFilter {
  const notDeleted = { fieldId: softDeleteFieldId, operator: 'isEmpty', value: null };
  return {
    conjunction: 'and',
    filterSet: filter ? [filter, notDeleted] : [notDeleted],
  } as IFilter;
}

/** Key each record's cells by field name instead of id. */
export function keyRecordsByName(
  records: IAiDataRecord[],
  fields: IAiDataFieldSummary[]
): IAiDataRecord[] {
  const names = new Map(fields.map((f) => [f.id, f.name]));
  return records.map(({ id, fields: cells }) => ({
    id,
    fields: Object.fromEntries(
      Object.entries(cells ?? {}).map(([key, value]) => [names.get(key) ?? key, value])
    ),
  }));
}
