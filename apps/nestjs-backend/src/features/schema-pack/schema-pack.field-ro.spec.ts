import { createFieldRoSchema, generateFieldId, generateTableId } from '@teable/core';
import { SCHEMA_PACK_IDS } from '@teable/openapi';
import { buildCatalog } from './schema-pack.catalog';
import type { IFieldRoContext } from './schema-pack.field-ro';
import { toFieldRo } from './schema-pack.field-ro';
import { planInstall } from './schema-pack.planner';

const catalog = buildCatalog();
const everything = planInstall(catalog, {
  packs: [...SCHEMA_PACK_IDS],
  optionalTables: catalog.packs.flatMap((p) =>
    p.tables.filter((t) => t.optional).map((t) => t.key)
  ),
  starterRows: true,
});

const tableIds = new Map<string, string>();
const fieldIds = new Map<string, string>();
const ctx: IFieldRoContext = {
  tableId: (key) => tableIds.get(key) ?? tableIds.set(key, generateTableId()).get(key)!,
  fieldId: (table, key) =>
    fieldIds.get(`${table}.${key}`) ??
    fieldIds.set(`${table}.${key}`, generateFieldId()).get(`${table}.${key}`)!,
  timezone: 'Europe/London',
  currencySymbol: '£',
};

const allFields = [
  ...everything.tables.flatMap((t) => t.fields.map((spec) => ({ table: t.key, spec }))),
  ...everything.links,
  ...everything.computed,
];

describe('toFieldRo', () => {
  it('covers every table and field of a full install', () => {
    expect(everything.tables).toHaveLength(17);
    expect(allFields.length).toBeGreaterThan(100);
  });

  it.each(allFields.map((f) => [`${f.table}.${f.spec.key}`, f] as const))(
    '%s is accepted by the create-field API schema',
    (_label, { table, spec }) => {
      const ro = toFieldRo(catalog, table, spec, ctx);
      const parsed = createFieldRoSchema.safeParse(ro);
      expect(parsed.error?.issues ?? []).toEqual([]);
    }
  );

  it('fills placeholders and resolves formula keys to ids', () => {
    const table = 'finance_Accounts';
    const spec = catalog.tables.get(table)!.fields.get('Current_Balance')!.spec!;
    const ro = toFieldRo(catalog, table, spec, ctx) as { options: Record<string, unknown> };
    expect(ro.options.expression).toBe(
      `{${ctx.fieldId(table, 'Opening_Balance')}} + {${ctx.fieldId(table, 'Net_Activity')}}`
    );
    expect(ro.options.formatting).toMatchObject({ symbol: '£' });
    const created = catalog.tables.get('tasks')!.fields.get('created_at')!.spec!;
    const createdRo = toFieldRo(catalog, 'tasks', created, ctx) as {
      options: { formatting: object };
    };
    expect(createdRo.options.formatting).toMatchObject({ timeZone: 'Europe/London' });
  });

  it('points a lookup through a symmetric link at the right table', () => {
    const spec = catalog.tables.get('finance_Accounts')!.fields.get('Own_Txn_Total')!.spec!;
    const ro = toFieldRo(catalog, 'finance_Accounts', spec, ctx) as unknown as {
      lookupOptions: Record<string, string>;
    };
    expect(ro.lookupOptions).toEqual({
      foreignTableId: ctx.tableId('finance_Transactions'),
      linkFieldId: ctx.fieldId('finance_Accounts', 'finance_Transactions'),
      lookupFieldId: ctx.fieldId('finance_Transactions', 'Signed_Amount'),
    });
  });
});
