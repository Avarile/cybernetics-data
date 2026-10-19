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

/** What the planner needs to know about a field that is already in the base. */
export interface IExistingField {
  type: FieldType;
  isLookup?: boolean;
}

export interface IPlanInput {
  packs: SchemaPackId[];
  optionalTables: string[];
  starterRows: boolean;
  /** Tables already in the target base, by name, with their fields by name. */
  existing?: Map<string, Map<string, IExistingField>>;
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

const kind = (type: string, isLookup?: boolean) => (isLookup ? `${type} lookup` : type);

/** A same-named field in the base only stands in for a pack field when it has the same type. */
export const isSameField = (field: ICatalogField, existing: IExistingField) =>
  existing.type === field.type && Boolean(existing.isLookup) === Boolean(field.spec?.isLookup);

/**
 * Decides exactly what an install creates. Pure: the installer executes the result, and the
 * wizard's Review step shows the same result, so the two can never disagree.
 *
 * Only selected tables are changed, plus bridge links to a selected pack. Catalog tables that are
 * already in the base (matched by name) can be linked to, but are never otherwise repaired.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export const planInstall = (catalog: ISchemaPackCatalog, input: IPlanInput): IInstallPlan => {
  const existing = input.existing ?? new Map<string, Map<string, IExistingField>>();
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
  const selectedKeys = new Set(selected.map((s) => s.table.key));
  // Tables that will be in the base afterwards: the selection plus catalog tables already there.
  const present = new Set(selectedKeys);
  for (const [key, { table }] of catalog.tables) {
    if (existing.has(table.name)) present.add(key);
  }
  const inScope = (field: ICatalogField) =>
    selectedKeys.has(field.table) || Boolean(field.bridge?.some((p) => input.packs.includes(p)));

  const tableName = (field: ICatalogField) => catalog.tables.get(field.table)!.table.name;
  const existingOf = (field: ICatalogField) => existing.get(tableName(field))?.get(field.name);
  const fieldExists = (field: ICatalogField) => {
    const found = existingOf(field);
    return Boolean(found && isSameField(field, found));
  };
  const ref = (f: { table: string; key: string }) => `${f.table}.${f.key}`;

  // Same name, different type: never bound to, and never created over.
  const conflicting = new Set<string>();
  const conflicts: string[] = [];
  const claim = (field: ICatalogField) => {
    const found = existingOf(field);
    if (!found || isSameField(field, found)) return true;
    conflicts.push(
      `${tableName(field)}.${field.name} is ${kind(found.type, found.isLookup)}, ` +
        `the pack needs ${kind(field.type, field.spec?.isLookup)}`
    );
    return false;
  };

  // A field is available when it already exists, or when this plan will create it.
  const available = new Set<string>();
  for (const [key, { fields }] of catalog.tables) {
    if (!present.has(key)) continue;
    for (const field of fields.values()) {
      if (fieldExists(field)) available.add(ref(field));
      else if (existingOf(field)) conflicting.add(ref(field));
    }
  }

  const tables: IPlannedTable[] = [];
  const created = new Map<string, ICatalogField[]>();
  const record = (field: ICatalogField) => {
    // A clash is reported, and nothing may be built on top of it.
    if (claim(field)) available.add(ref(field));
    created.set(field.table, [...(created.get(field.table) ?? []), field]);
  };

  for (const { pack, table } of selected) {
    const isExisting = existing.has(table.name);
    const fields = catalog.tables.get(table.key)!.fields;
    const toCreate = table.fields
      .filter((f) => !isLinkSpec(f) && !isComputedSpec(f))
      .filter((f) => !fieldExists(fields.get(f.key)!));
    toCreate.forEach((spec) => record(fields.get(spec.key)!));
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
      if (!spec || !isLinkSpec(spec) || !inScope(field) || fieldExists(field)) continue;
      const link = spec.link!;
      if (!present.has(link.table)) continue;
      // The cell shows the foreign primary when the chosen display field is not there.
      const shown = link.lookupField && available.has(`${link.table}.${link.lookupField}`);
      links.push({
        table: tableKey,
        spec:
          link.lookupField && !shown
            ? { ...spec, link: { ...link, lookupField: undefined } }
            : spec,
      });
      record(field);
      if (link.symmetric) record(catalog.tables.get(link.table)!.fields.get(link.symmetric.key)!);
    }
  }

  // Computed fields: repeatedly take those whose dependencies are all available.
  const pending: IPlannedField[] = [];
  for (const [tableKey, { fields }] of catalog.tables) {
    if (!present.has(tableKey)) continue;
    for (const field of fields.values()) {
      if (field.spec && isComputedSpec(field.spec) && inScope(field) && !fieldExists(field)) {
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
  // Left out because a table is missing is expected; left out because of a clash is not.
  for (const { table, spec } of pending) {
    const blockers = dependenciesOf(catalog, table, spec).filter((d) => conflicting.has(d));
    if (blockers.length) {
      conflicts.push(`${table}.${spec.key} needs ${blockers.join(', ')}, which has another type`);
    }
  }
  if (conflicts.length) {
    throw new SchemaPackPlanError(
      `The base already has fields with these names but different types: ${conflicts.join('; ')}`
    );
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
