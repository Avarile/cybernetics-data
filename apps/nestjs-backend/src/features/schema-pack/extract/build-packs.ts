import { FieldType, Relationship } from '@cybernetics/core';
import type {
  ISchemaPack,
  ISchemaPackBridge,
  ISchemaPackField,
  SchemaPackId,
} from '@teable/openapi';
import { SCHEMA_PACK_IDS, SCHEMA_PACK_PLACEHOLDER } from '@teable/openapi';
import type { IPackMap } from './pack-map';

/** The subset of a REST field VO the transform reads. */
export interface ISourceField {
  id: string;
  name: string;
  type: FieldType;
  isPrimary?: boolean;
  isComputed?: boolean;
  isLookup?: boolean;
  options?: Record<string, unknown>;
  lookupOptions?: { linkFieldId: string; foreignTableId: string; lookupFieldId: string };
}

export interface ISourceTable {
  id: string;
  name: string;
  fields: ISourceField[];
}

export interface IBuildPacksResult {
  packs: ISchemaPack[];
  bridges: ISchemaPackBridge[];
  report: string[];
}

interface ILinkOptions {
  relationship: Relationship;
  foreignTableId: string;
  lookupFieldId?: string;
  isOneWay?: boolean;
  symmetricFieldId?: string;
}

interface IFieldNode {
  table: ISourceTable;
  field: ISourceField;
  key: string;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const FORMULA_ID_REF = /\{(fld[A-Za-z0-9]+)\}/g;
// eslint-disable-next-line @typescript-eslint/naming-convention
const STRIP_EXPRESSION = new Set<FieldType>([
  FieldType.CreatedTime,
  FieldType.LastModifiedTime,
  FieldType.AutoNumber,
]);

/** `% Used` → `pct_Used`, `finance_Transactions (linked)` → `finance_Transactions_linked`. */
export const toKey = (name: string) => {
  const key = name
    .replace(/%/g, 'pct')
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z]/i.test(key) ? key : `f_${key}`;
};

const linkOptions = (field: ISourceField) => field.options as unknown as ILinkOptions;

/**
 * Turns a source base schema into schema packs. Pure: no I/O, ids never leak into the output,
 * and anything that cannot be shipped is dropped with a line in `report`, never silently.
 */
export const buildPacks = (
  sourceTables: ISourceTable[],
  map: IPackMap,
  version = 1
  // eslint-disable-next-line sonarjs/cognitive-complexity
): IBuildPacksResult => {
  const report: string[] = [];
  const byName = new Map(sourceTables.map((t) => [t.name, t]));
  const tables = Object.keys(map.tables).map((name) => {
    const table = byName.get(name);
    if (!table) throw new Error(`Pack map lists table "${name}", which is not in the source`);
    return table;
  });
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const packOf = (table: ISourceTable) => map.tables[table.name].pack;

  const nodes = new Map<string, IFieldNode>();
  for (const table of tables) {
    const seen = new Set<string>();
    for (const field of table.fields) {
      const key = toKey(field.name);
      if (seen.has(key)) throw new Error(`Duplicate key "${key}" in table "${table.name}"`);
      seen.add(key);
      nodes.set(field.id, { table, field, key });
    }
  }
  const order = (id: string) => {
    const node = nodes.get(id)!;
    return tables.indexOf(node.table) * 10_000 + node.table.fields.indexOf(node.field);
  };

  const kept = new Set<string>();
  const owners = new Map<string, ISchemaPackField>();
  const fixedSymmetricKeys = new Set<string>();

  // Pass 1: links. One side of every two-way pair owns it; the other becomes `symmetric`.
  for (const table of tables) {
    for (const [fieldName, fix] of Object.entries(map.linkFixes[table.name] ?? {})) {
      if (!table.fields.some((f) => f.name === fieldName)) {
        throw new Error(`Link fix for missing field ${table.name}.${fieldName}`);
      }
      fixedSymmetricKeys.add(`${table.name}.${fix.symmetric.key}`);
    }
  }
  for (const table of tables) {
    for (const field of table.fields) {
      const where = `${table.name}.${field.name}`;
      if (map.excludeFields[table.name]?.includes(field.name)) {
        report.push(`excluded ${where} (pack map)`);
        continue;
      }
      if (field.type !== FieldType.Link || field.isLookup) continue;
      const opts = linkOptions(field);
      const foreign = tableById.get(opts.foreignTableId);
      if (!foreign) {
        report.push(`dropped ${where}: links to a table that is not shipped`);
        continue;
      }
      const fix = map.linkFixes[table.name]?.[field.name];
      const symmetric = opts.symmetricFieldId ? nodes.get(opts.symmetricFieldId) : undefined;
      let symmetricSpec: { key: string; name: string } | undefined;
      if (fix) {
        symmetricSpec = fix.symmetric;
        report.push(`fixed ${where}: rebuilt as two-way with ${fix.symmetric.name}`);
      } else if (!opts.isOneWay && !symmetric) {
        if (fixedSymmetricKeys.has(`${table.name}.${toKey(field.name)}`)) {
          report.push(`dropped ${where}: replaced by a fixed link pair`);
          continue;
        }
        report.push(`changed ${where}: symmetric field missing in source, shipped one-way`);
      } else if (symmetric) {
        const isOwner =
          opts.relationship === Relationship.ManyOne ||
          (opts.relationship !== Relationship.OneMany &&
            order(field.id) < order(symmetric.field.id));
        if (!isOwner) continue;
        symmetricSpec = { key: symmetric.key, name: symmetric.field.name };
        kept.add(symmetric.field.id);
      }
      const lookupNode = opts.lookupFieldId ? nodes.get(opts.lookupFieldId) : undefined;
      const foreignPrimary = foreign.fields.find((f) => f.isPrimary);
      owners.set(field.id, {
        key: toKey(field.name),
        name: field.name,
        type: FieldType.Link,
        link: {
          table: foreign.name,
          relationship: opts.relationship,
          ...(symmetricSpec ? {} : { isOneWay: true }),
          ...(lookupNode && lookupNode.field.id !== foreignPrimary?.id
            ? { lookupField: lookupNode.key }
            : {}),
          ...(symmetricSpec ? { symmetric: symmetricSpec } : {}),
        },
      });
      kept.add(field.id);
    }
  }

  // Pass 2: computed fields, to a fixed point, since a formula may sit on a rollup.
  const dependsOn = (field: ISourceField): string[] => {
    if (field.isLookup || field.type === FieldType.Rollup) {
      const { linkFieldId, lookupFieldId } = field.lookupOptions!;
      return [linkFieldId, lookupFieldId];
    }
    if (field.type === FieldType.Formula) {
      const expression = String(field.options?.expression ?? '');
      return [...expression.matchAll(FORMULA_ID_REF)].map((m) => m[1]);
    }
    return [];
  };
  const isPlain = (field: ISourceField) =>
    !(field.type === FieldType.Link && !field.isLookup) && dependsOn(field).length === 0;

  for (const table of tables) {
    for (const field of table.fields) {
      if (isPlain(field) && !map.excludeFields[table.name]?.includes(field.name)) {
        kept.add(field.id);
      }
    }
  }
  const computed = tables.flatMap((t) =>
    t.fields.filter((f) => !isPlain(f) && !(f.type === FieldType.Link && !f.isLookup))
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const field of computed) {
      if (!kept.has(field.id) && dependsOn(field).every((id) => kept.has(id))) {
        kept.add(field.id);
        changed = true;
      }
    }
  }
  for (const field of computed) {
    if (!kept.has(field.id)) {
      const node = nodes.get(field.id)!;
      report.push(
        `dropped ${node.table.name}.${field.name}: depends on a field that is not shipped`
      );
    }
  }

  // Which packs must be installed for a field to exist.
  const requires = new Map<string, Set<SchemaPackId>>();
  const requiresOf = (id: string): Set<SchemaPackId> => {
    const cached = requires.get(id);
    if (cached) return cached;
    const { table, field } = nodes.get(id)!;
    const packs = new Set<SchemaPackId>([packOf(table)]);
    if (field.type === FieldType.Link && !field.isLookup) {
      packs.add(packOf(tableById.get(linkOptions(field).foreignTableId)!));
    }
    requires.set(id, packs);
    dependsOn(field).forEach((dep) => requiresOf(dep).forEach((p) => packs.add(p)));
    return packs;
  };

  const toSpec = (node: IFieldNode): ISchemaPackField => {
    const { table, field, key } = node;
    const owner = owners.get(field.id);
    if (owner) return owner;
    const spec: ISchemaPackField = { key, name: field.name, type: field.type };
    if (field.isPrimary) spec.isPrimary = true;
    if (field.isLookup || field.type === FieldType.Rollup) {
      const { linkFieldId, lookupFieldId } = field.lookupOptions!;
      spec.lookup = { link: nodes.get(linkFieldId)!.key, field: nodes.get(lookupFieldId)!.key };
      if (field.isLookup) {
        spec.isLookup = true;
        return spec;
      }
    }
    const options = toPackOptions(field, table, map, nodes);
    if (options && Object.keys(options).length) spec.options = options;
    return spec;
  };

  const packs = SCHEMA_PACK_IDS.map((id): ISchemaPack => ({ id, version, tables: [] }));
  const bridges = new Map<string, ISchemaPackBridge>();
  for (const table of tables) {
    const entry = map.tables[table.name];
    const fields: ISchemaPackField[] = [];
    for (const field of table.fields) {
      if (!kept.has(field.id)) continue;
      const isLink = field.type === FieldType.Link && !field.isLookup;
      if (isLink && !owners.has(field.id)) continue; // shipped as its owner's `symmetric`
      const needs = [...requiresOf(field.id)];
      const spec = toSpec(nodes.get(field.id)!);
      if (needs.length === 1) {
        fields.push(spec);
        continue;
      }
      if (needs.length > 2)
        throw new Error(`${table.name}.${field.name} spans ${needs.join(', ')}`);
      const pair = [...needs].sort(
        (a, b) => SCHEMA_PACK_IDS.indexOf(a) - SCHEMA_PACK_IDS.indexOf(b)
      ) as [SchemaPackId, SchemaPackId];
      const bridgeKey = pair.join('+');
      const bridge = bridges.get(bridgeKey) ?? { packs: pair, fields: [] };
      bridge.fields.push({ table: table.name, field: spec });
      bridges.set(bridgeKey, bridge);
    }
    packs
      .find((p) => p.id === entry.pack)!
      .tables.push({
        key: table.name,
        name: table.name,
        ...(entry.icon ? { icon: entry.icon } : {}),
        ...(entry.optional ? { optional: true } : {}),
        fields,
        ...(entry.views ? { views: entry.views } : {}),
      });
  }

  for (const pack of packs) {
    const count = pack.tables.reduce((n, t) => n + t.fields.length, 0);
    report.push(`pack ${pack.id}: ${pack.tables.length} tables, ${count} fields`);
  }
  const rank = (b: ISchemaPackBridge) =>
    SCHEMA_PACK_IDS.indexOf(b.packs[0]) * 10 + SCHEMA_PACK_IDS.indexOf(b.packs[1]);
  const sortedBridges = [...bridges.values()].sort((a, b) => rank(a) - rank(b));
  for (const bridge of sortedBridges) {
    const names = bridge.fields.map((f) => `${f.table}.${f.field.name}`).join(', ');
    report.push(`bridge ${bridge.packs.join(' + ')}: ${names}`);
  }
  return { packs, bridges: sortedBridges, report };
};

const substitute = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = substitute(v);
  }
  if ('timeZone' in out && typeof out.timeZone === 'string' && 'date' in out) {
    out.timeZone = SCHEMA_PACK_PLACEHOLDER.timezone;
  }
  if (out.type === 'currency' && 'symbol' in out) {
    out.symbol = SCHEMA_PACK_PLACEHOLDER.currencySymbol;
  }
  return out;
};

const toPackOptions = (
  field: ISourceField,
  table: ISourceTable,
  map: IPackMap,
  nodes: Map<string, IFieldNode>
): Record<string, unknown> | undefined => {
  const options = { ...(field.options ?? {}) };
  if (STRIP_EXPRESSION.has(field.type)) delete options.expression;
  if (field.type === FieldType.Formula) {
    options.expression = String(options.expression).replace(FORMULA_ID_REF, (_m, id: string) => {
      const node = nodes.get(id);
      if (!node || node.table !== table) {
        throw new Error(`${table.name}.${field.name} references ${id} outside its table`);
      }
      return `{@${node.key}}`;
    });
  }
  if (field.type === FieldType.SingleSelect || field.type === FieldType.MultipleSelect) {
    const renames = map.choiceRenames[table.name]?.[field.name] ?? {};
    const rename = (name: string) => renames[name] ?? name;
    const choices = (options.choices as { name: string; color: string }[]) ?? [];
    options.choices = choices.map(({ name, color }) => ({ name: rename(name), color }));
    if (typeof options.defaultValue === 'string')
      options.defaultValue = rename(options.defaultValue);
  }
  return substitute(options) as Record<string, unknown>;
};
