import { FieldType } from '@teable/core';
import type {
  ISchemaPackField,
  ISchemaPackPlanVo,
  ISchemaPackTable,
  ISchemaPackView,
  SchemaPackId,
} from '@teable/openapi';
import type { ICatalogField, ISchemaPackCatalog } from './schema-pack.catalog';
import { dependenciesOf, isLinkSpec, linkTarget } from './schema-pack.catalog';

export class SchemaPackPlanError extends Error {}

export interface IPlanInput {
  packs: SchemaPackId[];
  optionalTables: string[];
  starterRows: boolean;
  /** Tables already in the target base, by name, with the names of their fields. */
  existing?: Map<string, Set<string>>;
}

export interface IPlannedTable {
  key: string;
  name: string;
  pack: SchemaPackId;
  icon?: string;
  /** Already in the base: not created, but new fields may still be added to it. */
  existing: boolean;
  /** Fields created together with the table (no dependency on other tables). */
  fields: ISchemaPackField[];
  views: ISchemaPackView[];
}

export interface IPlannedField {
  table: string;
  spec: ISchemaPackField;
}

export interface ISeedRow {
  key?: string;
  fields: Record<string, unknown>;
  links: Record<string, string[]>;
}

export interface IInstallPlan {
  tables: IPlannedTable[];
  /** Link owners, in creation order; each also creates its symmetric field. */
  links: IPlannedField[];
  /** Lookups, rollups and formulas, in dependency order. */
  computed: IPlannedField[];
  seeds: { table: string; rows: ISeedRow[] }[];
  /** Every field the plan creates, grouped for display, symmetric fields included. */
  created: Map<string, ICatalogField[]>;
}

const isComputedSpec = (spec: ISchemaPackField) =>
  Boolean(spec.lookup) || spec.type === FieldType.Formula;

/**
 * Decides exactly what an install creates. Pure: the installer executes the result, and the
 * wizard's Review step shows the same result, so the two can never disagree.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export const planInstall = (catalog: ISchemaPackCatalog, input: IPlanInput): IInstallPlan => {
  const existing = input.existing ?? new Map<string, Set<string>>();
  const optionalKeys = new Set(
    catalog.packs
      .filter((p) => input.packs.includes(p.id))
      .flatMap((p) => p.tables.filter((t) => t.optional).map((t) => t.key))
  );
  const unknown = input.optionalTables.filter((k) => !optionalKeys.has(k));
  if (unknown.length) {
    throw new SchemaPackPlanError(
      `Not an optional table of the selected packs: ${unknown.join(', ')}`
    );
  }

  const selected: { pack: SchemaPackId; table: ISchemaPackTable }[] = catalog.packs
    .filter((p) => input.packs.includes(p.id))
    .flatMap((p) =>
      p.tables
        .filter((t) => !t.optional || input.optionalTables.includes(t.key))
        .map((table) => ({ pack: p.id, table }))
    );
  // Tables that will be in the base afterwards: the selection plus catalog tables already there.
  const present = new Set(selected.map((s) => s.table.key));
  for (const [key, { table }] of catalog.tables) {
    if (existing.has(table.name)) present.add(key);
  }

  const fieldExists = (field: ICatalogField) =>
    existing.get(catalog.tables.get(field.table)!.table.name)?.has(field.name) ?? false;

  // A field is available when it already exists, or when this plan will create it.
  const available = new Set<string>();
  const ref = (f: { table: string; key: string }) => `${f.table}.${f.key}`;
  for (const [, { fields }] of catalog.tables) {
    for (const field of fields.values()) if (fieldExists(field)) available.add(ref(field));
  }

  const tables: IPlannedTable[] = [];
  const created = new Map<string, ICatalogField[]>();
  const record = (field: ICatalogField) => {
    available.add(ref(field));
    created.set(field.table, [...(created.get(field.table) ?? []), field]);
  };

  for (const { pack, table } of selected) {
    const isExisting = existing.has(table.name);
    const plain = table.fields.filter((f) => !isLinkSpec(f) && !isComputedSpec(f));
    const toCreate = isExisting
      ? plain.filter((f) => !existing.get(table.name)!.has(f.name))
      : plain;
    toCreate.forEach((spec) => record(catalog.tables.get(table.key)!.fields.get(spec.key)!));
    tables.push({
      key: table.key,
      name: table.name,
      pack,
      icon: table.icon,
      existing: isExisting,
      fields: toCreate,
      views: isExisting ? [] : table.views ?? [],
    });
  }

  // Links (bridges included) whose both ends will be present.
  const links: IPlannedField[] = [];
  for (const [tableKey, { fields }] of catalog.tables) {
    if (!present.has(tableKey)) continue;
    for (const field of fields.values()) {
      const spec = field.spec;
      if (!spec || !isLinkSpec(spec) || fieldExists(field)) continue;
      if (!present.has(spec.link!.table)) continue;
      links.push({ table: tableKey, spec });
      record(field);
      if (spec.link!.symmetric) {
        record(catalog.tables.get(spec.link!.table)!.fields.get(spec.link!.symmetric.key)!);
      }
    }
  }

  // Computed fields: repeatedly take those whose dependencies are all available.
  const pending: IPlannedField[] = [];
  for (const [tableKey, { fields }] of catalog.tables) {
    if (!present.has(tableKey)) continue;
    for (const field of fields.values()) {
      if (field.spec && isComputedSpec(field.spec) && !fieldExists(field)) {
        pending.push({ table: tableKey, spec: field.spec });
      }
    }
  }
  const computed: IPlannedField[] = [];
  for (let progressed = true; progressed && pending.length; ) {
    progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const { table, spec } = pending[i];
      if (dependenciesOf(catalog, table, spec).every((d) => available.has(d))) {
        computed.push(pending[i]);
        record(catalog.tables.get(table)!.fields.get(spec.key)!);
        pending.splice(i--, 1);
        progressed = true;
      }
    }
  }

  return { tables, links, computed, seeds: planSeeds(catalog, input, tables, available), created };
};

const planSeeds = (
  catalog: ISchemaPackCatalog,
  input: IPlanInput,
  tables: IPlannedTable[],
  available: Set<string>
) => {
  if (!input.starterRows) return [];
  const fresh = new Set(tables.filter((t) => !t.existing).map((t) => t.key));
  const seeded = catalog.seeds.flatMap((s) => s.tables).filter((t) => fresh.has(t.table));
  const rowKeys = new Map(
    seeded.map((t) => [t.table, new Set(t.rows.flatMap((r) => (r.key ? [r.key] : [])))])
  );
  return seeded.map(({ table, rows }) => ({
    table,
    rows: rows.map((row): ISeedRow => {
      const links: Record<string, string[]> = {};
      for (const [key, targets] of Object.entries(row.links ?? {})) {
        const field = catalog.tables.get(table)!.fields.get(key)!;
        const foreign = linkTarget(catalog, field)!;
        const kept = targets.filter((t) => rowKeys.get(foreign)?.has(t));
        if (available.has(`${table}.${key}`) && kept.length) links[key] = kept;
      }
      return {
        ...(row.key ? { key: row.key } : {}),
        fields: Object.fromEntries(
          Object.entries(row.fields).filter(([key]) => available.has(`${table}.${key}`))
        ),
        links,
      };
    }),
  }));
};

/** The plan as the wizard's Review step shows it. */
export const toPlanVo = (catalog: ISchemaPackCatalog, plan: IInstallPlan): ISchemaPackPlanVo => {
  const tableKeys = new Set([...plan.tables.map((t) => t.key), ...plan.created.keys()]);
  const tables = [...tableKeys].map((key) => {
    const { pack, table } = catalog.tables.get(key)!;
    const planned = plan.tables.find((t) => t.key === key);
    const fields = [...catalog.tables.get(key)!.fields.values()]
      .filter((f) => plan.created.get(key)?.includes(f))
      .map((f) => ({
        key: f.key,
        name: f.name,
        type: f.type,
        ...(f.spec?.isLookup ? { isLookup: true } : {}),
        ...(f.bridge ? { bridge: f.bridge.find((p) => p !== pack) ?? pack } : {}),
      }));
    return { key, name: table.name, pack, existing: planned ? planned.existing : true, fields };
  });
  const fieldCount = [...plan.created.values()].reduce((n, fields) => n + fields.length, 0);
  return {
    tables,
    counts: {
      tables: plan.tables.filter((t) => !t.existing).length,
      fields: fieldCount,
      links: plan.links.length,
      seedRows: plan.seeds.reduce((n, s) => n + s.rows.length, 0),
    },
  };
};
