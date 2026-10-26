import type { FieldType } from '@cybernetics/core';
import type { ISchemaPackCatalog } from '../../../schema-pack/schema-pack.catalog';
import type { IExistingBase, IExistingFieldRef } from '../../../schema-pack/schema-pack.installer';
import { isSameField } from '../../../schema-pack/schema-pack.planner';

export interface IActualField {
  id: string;
  name: string;
  type: string;
  isLookup?: boolean | null;
}

export interface IActualTable {
  id: string;
  name: string;
  fields: IActualField[];
}

/** table key -> table id */
export type ITableMap = Record<string, string>;
/** table key -> field key -> field id */
export type IFieldMap = Record<string, Record<string, string>>;

export interface IVerifyResult {
  /** The base as the planner should see it: pack tables and fields under their pack names. */
  existing: IExistingBase;
  tableMap: ITableMap;
  fieldMap: IFieldMap;
  missingTables: string[];
  /** `table.field` */
  missingFields: string[];
  /** Found by id under another name (admin renamed them); kept as they are. */
  renamed: string[];
  /** Same field, different type: not repaired, reported in health. */
  mismatched: { field: string; actual: string; expected: string }[];
  /**
   * Pack links that are links no more: deleting a linked table turns the link on the other side
   * into text. They count as missing; the caller moves them aside so the link can be rebuilt.
   */
  detached: { field: string; tableId: string; fieldId: string; name: string }[];
}

type ICatalogTableFields =
  ISchemaPackCatalog['tables'] extends Map<string, infer T>
    ? T extends { fields: infer F }
      ? F
      : never
    : never;

/** Match one table's pack fields; returns the table as the planner should see it. */
function verifyFields(
  tableKey: string,
  fields: ICatalogTableFields,
  found: IActualTable,
  storedFields: Record<string, string>,
  result: IVerifyResult
) {
  const view = new Map<string, IExistingFieldRef>();
  const usedFields = new Set<string>();
  for (const field of fields.values()) {
    const key = `${tableKey}.${field.key}`;
    const match =
      found.fields.find((f) => f.id === storedFields[field.key]) ??
      found.fields.find((f) => f.name === field.name && !usedFields.has(f.id));
    if (!match) {
      result.missingFields.push(key);
      continue;
    }
    if (field.type === 'link' && match.type !== 'link') {
      result.missingFields.push(key);
      result.detached.push({ field: key, tableId: found.id, fieldId: match.id, name: match.name });
      continue;
    }
    usedFields.add(match.id);
    result.fieldMap[tableKey][field.key] = match.id;
    if (match.name !== field.name) result.renamed.push(key);
    const ref = { id: match.id, type: match.type as FieldType, isLookup: Boolean(match.isLookup) };
    if (!isSameField(field, ref)) {
      result.mismatched.push({ field: key, actual: match.type, expected: field.type });
    }
    // Under its pack name with the pack's type, so the planner neither recreates nor rejects it.
    view.set(field.name, { ...ref, type: field.type, isLookup: Boolean(field.spec?.isLookup) });
  }
  // Columns the admin added stay visible under their own names (the planner avoids clashes).
  for (const f of found.fields) {
    if (!usedFields.has(f.id) && !view.has(f.name)) {
      view.set(f.name, { id: f.id, type: f.type as FieldType, isLookup: Boolean(f.isLookup) });
    }
  }
  return view;
}

/**
 * Compare the Agent base with the pack. Tables and fields are found by their stored id first, then
 * by name, so an admin renaming a column never makes the agent recreate it (design §7.4 step 3).
 */
export function verifyAgainstPack(
  catalog: ISchemaPackCatalog,
  actual: IActualTable[],
  stored: { tableMap: ITableMap; fieldMap: IFieldMap }
): IVerifyResult {
  const result: IVerifyResult = {
    existing: { tableIds: new Map(), fields: new Map() },
    tableMap: {},
    fieldMap: {},
    missingTables: [],
    missingFields: [],
    renamed: [],
    mismatched: [],
    detached: [],
  };
  const usedTables = new Set<string>();

  for (const [tableKey, { table, fields }] of catalog.tables) {
    const found =
      actual.find((t) => t.id === stored.tableMap[tableKey]) ??
      actual.find((t) => t.name === table.name && !usedTables.has(t.id));
    if (!found) {
      result.missingTables.push(tableKey);
      continue;
    }
    usedTables.add(found.id);
    result.tableMap[tableKey] = found.id;
    if (found.name !== table.name) result.renamed.push(tableKey);

    result.fieldMap[tableKey] = {};
    const view = verifyFields(tableKey, fields, found, stored.fieldMap[tableKey] ?? {}, result);
    result.existing.tableIds.set(table.name, found.id);
    result.existing.fields.set(table.name, view);
  }
  return result;
}

export const needsRepair = (r: IVerifyResult) =>
  r.missingTables.length > 0 || r.missingFields.length > 0;
