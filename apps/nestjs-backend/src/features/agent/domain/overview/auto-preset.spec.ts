/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
import type { IBaseGraphNode } from '@teable/openapi';
import type { ISearchSchema } from '../ports';
import type { ITableSchema } from '../search/schema';
import { DATA_CENTRE_SCHEMA, dataCentreSchema } from './__fixtures__/data-centre-schema';
import { encodeOverview } from './encode';
import { presetOf } from './presets';
import { resolveOverview } from './resolve';

const now = new Date('2026-10-30T00:00:00.000Z');
const schema = dataCentreSchema();
const tableNamed = (name: string, s: ISearchSchema = schema) =>
  s.tables.find((t) => t.name === name)!;
const presetNamed = (name: string, s: ISearchSchema = schema) => presetOf(tableNamed(name, s), s);

/** A small base the curated datasets know nothing of. */
const demoTables: ITableSchema[] = [
  {
    id: 'tblOrders',
    name: 'orders',
    baseId: 'bseDemo',
    fields: [
      { id: 'oName', name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: 'oStatus', name: 'Status', type: 'singleSelect', choices: ['Todo', 'Done'] },
      { id: 'oTotal', name: 'Total', type: 'currency' },
      { id: 'oToken', name: 'api_token', type: 'singleSelect', choices: ['a'] },
      { id: 'oChanged', name: 'Changed', type: 'lastModifiedTime', isComputed: true },
      {
        id: 'oCustomer',
        name: 'Customer',
        type: 'link',
        link: { foreignTableId: 'tblCustomers', relationship: 'manyOne', isOneWay: true },
      },
      {
        id: 'oProducts',
        name: 'Products',
        type: 'link',
        link: { foreignTableId: 'tblProducts', relationship: 'manyMany', isOneWay: true },
      },
    ],
  },
  {
    id: 'tblCustomers',
    name: 'customers',
    baseId: 'bseDemo',
    fields: [{ id: 'cName', name: 'Name', type: 'singleLineText', isPrimary: true }],
  },
  {
    id: 'tblProducts',
    name: 'products',
    baseId: 'bseDemo',
    fields: [
      { id: 'prName', name: 'Name', type: 'singleLineText', isPrimary: true },
      { id: 'prKind', name: 'Kind', type: 'singleSelect', choices: ['Book', 'Game'] },
    ],
  },
];
const demo: ISearchSchema = {
  baseId: 'bseDemo',
  baseName: 'demo_database',
  tables: demoTables,
  excluded: new Set(),
};

describe('presetOf', () => {
  it('draws the anchor tables by their curated dataset, TYPES kept for knowledges', () => {
    const knowledge = presetNamed('knowledges');
    expect(knowledge.preset).toBe('knowledge');
    expect(knowledge.presentation.branchTitle).toBe('TYPES');
    expect(knowledge.dataset.id).toBe('knowledge');
    expect(presetNamed('tasks').preset).toBe('work');
    expect(presetNamed('contacts').preset).toBe('people');
    expect(presetNamed('finance_Transactions').preset).toBe('finance');
  });

  it('gives every other table a preset that resolves against its base', () => {
    for (const table of DATA_CENTRE_SCHEMA.filter((t) => t.name !== 'system_info')) {
      const p = presetOf(table, schema);
      const r = resolveOverview(p.dataset, schema, now);
      expect(r.query, table.name).not.toBeNull();
      expect(
        r.tables.map((t) => t.table.id),
        table.name
      ).toContain(table.id);
    }
  });

  it('hangs projects under their goal, toned by progress, with the share done', () => {
    const p = presetNamed('projects');
    expect(p.preset).toBeNull();
    const [goals, projects] = p.dataset.tables;
    expect(goals).toMatchObject({ name: 'goals', role: 'branch', orphan: null });
    expect(projects).toMatchObject({
      name: 'projects',
      role: 'item',
      groupBy: 'belong_goals',
      tone: 'progress',
      orphan: 'PROJECTS',
      short: 'PROJECT',
    });
    expect(p.presentation).toMatchObject({ branchTitle: 'GOALS', unit: 'RECORDS', right: 'pct' });
    expect(p.dataset.path).toMatch(/^GOALS → PROJECTS/);
  });

  it('draws a self-linked table as a tree and a type select as its branches', () => {
    const p = presetNamed('finance_Categories');
    const item = p.dataset.tables.find((t) => t.role === 'item')!;
    expect(item).toMatchObject({
      hierarchy: 'Parent Category',
      groupSelect: 'Type',
      tone: 'fresh',
    });
    expect(p.presentation.branchTitle).toBe('TYPE');
    expect(p.presentation.legend).toContainEqual(['none', 'TYPE', 'ring']);
  });

  it('reads a table the datasets do not know: status, money, a group and linked tables', () => {
    const p = presetOf(demoTables[0], demo);
    expect(p.dataset.tables.map((t) => [t.name, t.role])).toEqual([
      ['customers', 'branch'],
      ['orders', 'item'],
      ['products', 'actor'],
    ]);
    const orders = p.dataset.tables[1];
    expect(orders).toMatchObject({ tone: 'Status', money: 'Total', groupBy: 'Customer' });
    expect(orders.date?.[0]).toBe('Changed');
    expect(p.dataset.edges).toEqual(['Products']);
    expect(p.presentation).toMatchObject({ branchTitle: 'CUSTOMERS', right: 'sum' });
    expect(p.presentation.legend).toContainEqual(['target', 'PRODUCTS', 'diamond']);
    expect(JSON.stringify(p)).not.toMatch(/api_token/);
  });

  it('falls back to freshness and the table hub when nothing groups the records', () => {
    const p = presetOf(demoTables[1], demo);
    expect(p.dataset.tables).toEqual([
      expect.objectContaining({
        name: 'customers',
        role: 'item',
        tone: 'fresh',
        orphan: 'CUSTOMERS',
      }),
    ]);
    expect(p.presentation.toneNames).toMatchObject({ route: 'UPDATED 7D' });
  });
});

describe('encodeOverview with a select as branches', () => {
  const node = (id: string, kind: string | null): IBaseGraphNode => ({
    id: `rec:${id}`,
    kind: 'record',
    tableId: 'tblProducts',
    recordId: id,
    label: id,
    parentId: null,
    colorKey: null,
    depth: 0,
    degree: 0,
    values: { prKind: kind },
  });

  it('puts each record under the hub of its value, an empty one under the table hub', () => {
    const p = presetOf(demoTables[2], demo);
    const r = resolveOverview(p.dataset, demo, now);
    expect(r.query!.tables[0].valueFieldIds).toContain('prKind');
    const out = encodeOverview(
      r,
      {
        nodes: [node('A', 'Book'), node('B', 'Book'), node('C', 'Game'), node('D', null)],
        links: [],
        stats: { perTable: [], truncated: { nodes: false, links: false } },
      },
      now
    );
    const parent = Object.fromEntries(out.nodes.map((n) => [n.id, n.parent]));
    expect(parent).toMatchObject({
      'rec:A': 'sel:prKind:Book',
      'rec:B': 'sel:prKind:Book',
      'rec:C': 'sel:prKind:Game',
      'rec:D': 'hub:tblProducts',
    });
    expect(out.nodes.find((n) => n.id === 'sel:prKind:Game')).toMatchObject({
      kind: 'hub',
      label: 'Game',
    });
  });
});
