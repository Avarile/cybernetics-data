/* eslint-disable @typescript-eslint/naming-convention */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FieldType, Relationship } from '@teable/core';
import { schemaPackBridgeSchema, schemaPackSchema } from '@teable/openapi';
import type { ISourceTable } from './build-packs';
import { buildPacks, toKey } from './build-packs';
import { PACK_MAP } from './pack-map';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/data-centre.schema.json'), 'utf8')
) as { tables: ISourceTable[] };
const packsDir = join(__dirname, '../packs');

/**
 * Golden test. The committed pack JSON must equal what the transform builds from the
 * captured source schema. To regenerate after changing the map or the fixture:
 *   UPDATE_PACKS=1 pnpm -F @teable/backend exec vitest run src/features/schema-pack/extract
 */
describe('buildPacks (data-centre)', () => {
  const result = buildPacks(fixture.tables, PACK_MAP);
  const files: Record<string, unknown> = {
    ...Object.fromEntries(result.packs.map((p) => [`${p.id}.pack.json`, p])),
    'bridges.json': result.bridges,
  };

  if (process.env.UPDATE_PACKS) {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(packsDir, name), JSON.stringify(content, null, 2) + '\n');
    }
  }

  it.each(Object.keys(files))('%s matches the committed file', (name) => {
    const committed = JSON.parse(readFileSync(join(packsDir, name), 'utf8'));
    expect(committed).toEqual(files[name]);
  });

  it('produces valid packs and bridges', () => {
    result.packs.forEach((p) => expect(() => schemaPackSchema.parse(p)).not.toThrow());
    result.bridges.forEach((b) => expect(() => schemaPackBridgeSchema.parse(b)).not.toThrow());
  });

  it('leaks no source ids and no excluded fields', () => {
    const json = JSON.stringify(files);
    expect(json).not.toMatch(/\b(fld|tbl|bse|cho)[A-Za-z0-9]{8,}/);
    expect(json).not.toContain('credentials');
    expect(json).not.toContain('Australia/Melbourne');
    expect(json).not.toContain('Organge');
  });

  it('ships only mapped tables', () => {
    const shipped = result.packs.flatMap((p) => p.tables.map((t) => t.key));
    expect(shipped.sort()).toEqual(Object.keys(PACK_MAP.tables).sort());
  });

  it('derives the cross-pack bridges', () => {
    const summary = result.bridges.map((b) => ({
      packs: b.packs,
      fields: b.fields.map((f) => `${f.table}.${f.field.key}`).sort(),
    }));
    expect(summary).toEqual([
      {
        packs: ['progress', 'people'],
        fields: ['projects.lead_by', 'tasks.assigned_to'],
      },
      {
        packs: ['progress', 'knowledge'],
        fields: ['goals.refer_knowledge', 'projects.refer_knowledge', 'tasks.refer_knowledge'],
      },
    ]);
  });

  it('keeps one owner per two-way link and names its symmetric side', () => {
    const tasks = result.packs[0].tables.find((t) => t.key === 'tasks')!;
    const belongProject = tasks.fields.find((f) => f.key === 'belong_project')!;
    expect(belongProject.link).toEqual({
      table: 'projects',
      relationship: Relationship.ManyOne,
      symmetric: { key: 'tasks', name: 'tasks' },
    });
    const projects = result.packs[0].tables.find((t) => t.key === 'projects')!;
    expect(projects.fields.find((f) => f.key === 'tasks')).toBeUndefined();
  });

  it('repairs the knowledge_type hierarchy', () => {
    const types = result.packs[2].tables.find((t) => t.key === 'knowledge_type')!;
    expect(types.fields.find((f) => f.key === 'parent_type')?.link?.symmetric).toEqual({
      key: 'child_types',
      name: 'child_types',
    });
    expect(types.fields.find((f) => f.key === 'child_types')).toBeUndefined();
    expect(result.report).toContain(
      'dropped knowledge_type.child_types: replaced by a fixed link pair'
    );
  });

  it('rewrites formulas and rollups to keys and placeholders', () => {
    const accounts = result.packs[3].tables.find((t) => t.key === 'finance_Accounts')!;
    const balance = accounts.fields.find((f) => f.key === 'Current_Balance')!;
    expect(balance.options?.expression).toBe('{@Opening_Balance} + {@Net_Activity}');
    expect(balance.options?.formatting).toMatchObject({ symbol: '{{currencySymbol}}' });
    const own = accounts.fields.find((f) => f.key === 'Own_Txn_Total')!;
    expect(own.type).toBe(FieldType.Rollup);
    expect(own.lookup).toEqual({ link: 'finance_Transactions', field: 'Signed_Amount' });
  });

  it('reports every change it made', () => {
    expect(result.report).toEqual(
      expect.arrayContaining([
        'excluded knowledge_type.credentials (pack map)',
        'changed knowledges.related_knowledge: symmetric field missing in source, shipped one-way',
        'fixed knowledge_type.parent_type: rebuilt as two-way with child_types',
      ])
    );
  });
});

describe('toKey', () => {
  it.each([
    ['% Used', 'pct_Used'],
    ['finance_Transactions (linked)', 'finance_Transactions_linked'],
    ['Opening Balance Date', 'Opening_Balance_Date'],
    ['2fa', 'f_2fa'],
  ])('%s → %s', (name, key) => expect(toKey(name)).toBe(key));
});
