/* eslint-disable @typescript-eslint/naming-convention */
import type { SchemaPackId } from '@teable/openapi';
import { SCHEMA_PACK_IDS } from '@teable/openapi';
import bridgesJson from './packs/bridges.json';
import financeJson from './packs/finance.pack.json';
import knowledgeJson from './packs/knowledge.pack.json';
import peopleJson from './packs/people.pack.json';
import progressJson from './packs/progress.pack.json';
import { buildCatalog, dependenciesOf, toCatalogVo } from './schema-pack.catalog';
import { planInstall, SchemaPackPlanError, toPlanVo } from './schema-pack.planner';
import progressSeedJson from './seeds/progress.seed.json';

const catalog = buildCatalog();
const CORE: Record<SchemaPackId, string[]> = {
  progress: ['goals', 'projects', 'tasks'],
  people: ['contacts', 'companies', 'contact_type', 'contact_profession'],
  knowledge: ['knowledges', 'knowledge_type'],
  finance: ['finance_Accounts', 'finance_Categories', 'finance_Payees', 'finance_Transactions'],
};

const subsets = (ids: readonly SchemaPackId[]): SchemaPackId[][] =>
  ids.reduce<SchemaPackId[][]>((acc, id) => [...acc, ...acc.map((s) => [...s, id])], [[]]).slice(1);

const plan = (packs: SchemaPackId[], optionalTables: string[] = [], starterRows = true) =>
  planInstall(catalog, { packs, optionalTables, starterRows });

const fieldKeys = (p: ReturnType<typeof plan>, table: string) =>
  (p.created.get(table) ?? []).map((f) => f.key);

describe('schema pack catalog', () => {
  it('loads and cross-checks the shipped packs and seeds', () => {
    expect([...catalog.tables.keys()]).toHaveLength(17);
    const vo = toCatalogVo(catalog);
    expect(vo.packs.map((p) => p.id)).toEqual([...SCHEMA_PACK_IDS]);
    expect(vo.bridges.map((b) => b.packs.join('+'))).toEqual([
      'progress+people',
      'progress+knowledge',
    ]);
    // Bridge fields are listed under the bridge, not under either pack.
    const contacts = vo.packs[1].tables.find((t) => t.key === 'contacts')!;
    expect(contacts.fields.map((f) => f.key)).not.toContain('tasks');
  });

  const raw = () => ({
    packs: structuredClone([progressJson, peopleJson, knowledgeJson, financeJson]),
    bridges: structuredClone(bridgesJson),
    seeds: [structuredClone(progressSeedJson)],
  });

  it('rejects a formula that references a missing field', () => {
    const broken = raw();
    const accounts = broken.packs[3].tables.find((t) => t.key === 'finance_Accounts')!;
    const balance = accounts.fields.find((f) => f.key === 'Current_Balance')!;
    (balance.options as { expression: string }).expression = '{@Nope} + 1';
    expect(() => buildCatalog(broken)).toThrow(/Current_Balance needs finance_Accounts.Nope/);
  });

  it('rejects a seed value that is not a choice', () => {
    const broken = raw();
    (broken.seeds[0].tables[2].rows[0].fields as Record<string, string>).progress = 'done';
    expect(() => buildCatalog(broken)).toThrow(/not one of its choices/);
  });

  it('rejects a seed link to an unknown row', () => {
    const broken = raw();
    (broken.seeds[0].tables[1].rows[0] as { links?: Record<string, string[]> }).links = {
      belong_goals: ['missing'],
    };
    expect(() => buildCatalog(broken)).toThrow(/links to unknown goals rows missing/);
  });
});

describe('planInstall', () => {
  it.each(subsets(SCHEMA_PACK_IDS).map((s) => [s.join('+'), s]))(
    '%s: core tables, bridges only when both packs are chosen',
    (_label, packs) => {
      const p = plan(packs as SchemaPackId[]);
      const expected = (packs as SchemaPackId[]).flatMap((id) => CORE[id]);
      expect(p.tables.map((t) => t.key).sort()).toEqual(expected.sort());
      const has = (id: SchemaPackId) => (packs as SchemaPackId[]).includes(id);
      const linkKeys = p.links.map((l) => `${l.table}.${l.spec.key}`);
      expect(linkKeys.includes('tasks.assigned_to')).toBe(has('progress') && has('people'));
      expect(linkKeys.includes('goals.refer_knowledge')).toBe(has('progress') && has('knowledge'));
      // Every computed field is created after everything it reads.
      const done = new Set<string>();
      p.tables.forEach((t) => t.fields.forEach((f) => done.add(`${t.key}.${f.key}`)));
      p.links.forEach((l) => {
        done.add(`${l.table}.${l.spec.key}`);
        if (l.spec.link?.symmetric) done.add(`${l.spec.link.table}.${l.spec.link.symmetric.key}`);
      });
      for (const c of p.computed) {
        dependenciesOf(catalog, c.table, c.spec).forEach((d) => expect(done).toContain(d));
        done.add(`${c.table}.${c.spec.key}`);
      }
    }
  );

  it('prunes fields that depend on an optional table left out', () => {
    const without = plan(['finance']);
    expect(fieldKeys(without, 'finance_Transactions')).not.toContain('Budget');
    expect(fieldKeys(without, 'finance_Transactions')).not.toContain('Tags');
    expect(fieldKeys(without, 'finance_Accounts')).toContain('Current_Balance');
    const withBudgets = plan(['finance'], ['finance_Budgets']);
    expect(fieldKeys(withBudgets, 'finance_Budgets')).toEqual(
      expect.arrayContaining(['Actual_Spent', 'Variance', 'pct_Used', 'Scope'])
    );
    expect(fieldKeys(withBudgets, 'finance_Transactions')).toContain('Budget');
  });

  it('refuses an optional table outside the selected packs', () => {
    expect(() => plan(['progress'], ['finance_Budgets'])).toThrow(SchemaPackPlanError);
  });

  it('adds only the missing pieces to an existing base', () => {
    const first = plan(['progress']);
    const existing = new Map<string, Set<string>>();
    for (const [table, fields] of first.created) {
      existing.set(table, new Set(fields.map((f) => f.name)));
    }
    const second = planInstall(catalog, {
      packs: ['people'],
      optionalTables: [],
      starterRows: true,
      existing,
    });
    expect(second.tables.map((t) => t.key).sort()).toEqual([...CORE.people].sort());
    expect(second.links.map((l) => `${l.table}.${l.spec.key}`)).toEqual(
      expect.arrayContaining(['projects.lead_by', 'tasks.assigned_to'])
    );
    expect(second.links.map((l) => l.table)).not.toContain('goals');
    expect(second.computed).toHaveLength(0);
    // Seeds only go into the tables this install creates.
    expect(second.seeds.map((s) => s.table)).toEqual(['contact_type']);
  });

  it('plans seeds with resolvable links, or none when starter rows are off', () => {
    const p = plan(['progress']);
    const tasks = p.seeds.find((s) => s.table === 'tasks')!;
    expect(tasks.rows.every((r) => r.links.belong_project?.[0] === 'setup')).toBe(true);
    expect(p.seeds.find((s) => s.table === 'project_frameworks')).toBeUndefined();
    expect(plan(['progress'], [], false).seeds).toEqual([]);
  });

  it('summarises the plan for the Review step', () => {
    const vo = toPlanVo(catalog, plan(['progress', 'people']));
    expect(vo.counts.tables).toBe(7);
    expect(vo.counts.links).toBeGreaterThan(0);
    const tasks = vo.tables.find((t) => t.key === 'tasks')!;
    expect(tasks.fields.find((f) => f.key === 'assigned_to')?.bridge).toBe('people');
    const contacts = vo.tables.find((t) => t.key === 'contacts')!;
    expect(contacts.fields.find((f) => f.key === 'tasks')?.bridge).toBe('progress');
  });
});
