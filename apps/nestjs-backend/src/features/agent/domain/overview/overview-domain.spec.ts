/* eslint-disable sonarjs/no-duplicate-string */
import type { IBaseGraphLink, IBaseGraphNode } from '@teable/openapi';
import { DATA_CENTRE_SCHEMA, dataCentreSchema } from './__fixtures__/data-centre-schema';
import { datasetOf } from './datasets';
import { encodeOverview, type IOverviewGraph } from './encode';
import { resolveOverview } from './resolve';

const now = new Date('2026-10-30T00:00:00.000Z');
const resolve = (id: Parameters<typeof datasetOf>[0], schema = dataCentreSchema()) =>
  resolveOverview(datasetOf(id), schema, now);
const tableOf = (r: ReturnType<typeof resolve>, tableId: string) =>
  r.query!.tables.find((t) => t.tableId === tableId)!;

/** A base-graph record node, with the values it carries. */
const rec = (
  tableId: string,
  recordId: string,
  label: string,
  parentId: string | null = null,
  values?: Record<string, unknown>
): IBaseGraphNode => ({
  id: `rec:${recordId}`,
  kind: 'record',
  tableId,
  recordId,
  label,
  parentId,
  colorKey: null,
  depth: 0,
  degree: 0,
  ...(values ? { values } : {}),
});
const none = (fieldId: string, tableId: string): IBaseGraphNode => ({
  id: `grp:${fieldId}:__none__`,
  kind: 'group',
  tableId,
  recordId: null,
  label: 'Unclassified',
  parentId: null,
  colorKey: null,
  depth: 0,
  degree: 0,
});
const edge = (a: string, b: string, fieldId: string): IBaseGraphLink => ({
  source: `rec:${a}`,
  target: `rec:${b}`,
  kind: 'link',
  fieldId,
});
const graph = (nodes: IBaseGraphNode[], links: IBaseGraphLink[] = []): IOverviewGraph => ({
  nodes,
  links,
  stats: { perTable: [], truncated: { nodes: false, links: false } },
});
const active = (p: string, extra: Record<string, unknown> = {}) => ({
  [`${p}Active`]: true,
  ...extra,
});

describe('resolveOverview', () => {
  it('turns WORK into one base-graph query by ids: the tree, the values, the edges', () => {
    const r = resolve('work');
    expect(r.missing).toEqual([]);
    expect(tableOf(r, 'tblProjects')).toMatchObject({
      groupByFieldId: 'pGoal',
      valueFieldIds: ['pProgress', 'pUpdated', 'pCreated', 'pActive'],
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'pDeleted', operator: 'isEmpty', value: null }],
      },
    });
    expect(tableOf(r, 'tblTasks')).toMatchObject({
      groupByFieldId: 'tProject',
      valueFieldIds: [
        'tProgress',
        'tPriority',
        'tFinished',
        'tStarted',
        'tUpdated',
        'tCreated',
        'tActive',
      ],
    });
    // the tree's own fields are never edges; the named links are
    expect(r.query!.linkFieldIds).toEqual(['gRefer', 'pLead', 'pRefer', 'tAssigned', 'tRefer']);
    expect(r.query).toMatchObject({ showTableHubs: false, showBaseHub: false });
  });

  it('keeps PEOPLE to open work, and never draws the other side of a tree link', () => {
    const r = resolve('people');
    const states = (tableId: string) =>
      (
        tableOf(r, tableId).filter as { filterSet: { operator: string; value: unknown }[] }
      ).filterSet.find((f) => f.operator === 'isNoneOf')?.value;
    expect(states('tblTasks')).toEqual([
      'finished_reviewing',
      'finished_validating',
      'cancelled',
      'closed',
    ]);
    expect(states('tblProjects')).toEqual(['finished-reviewing', 'finalized', 'cancelled']);
    expect(tableOf(r, 'tblContacts').groupByFieldId).toBe('cType');
    expect(r.query!.linkFieldIds).toEqual(['cCompany', 'cProfession', 'tProject']);
  });

  it('reads FINANCE over a 90-day window, and names what the base lacks', () => {
    const r = resolve(
      'finance',
      dataCentreSchema(DATA_CENTRE_SCHEMA.filter((t) => t.name !== 'finance_Accounts'))
    );
    expect(r.missing).toEqual(['finance_Accounts']);
    const txn = tableOf(r, 'tblTransactions');
    expect(txn.valueFieldIds).toEqual(['ftType', 'ftAmount', 'ftDate']);
    expect((txn.filter as { filterSet: unknown[] }).filterSet).toEqual([
      {
        fieldId: 'ftDate',
        operator: 'isOnOrAfter',
        value: { mode: 'exactDate', exactDate: '2026-08-01T00:00:00.000Z', timeZone: 'UTC' },
      },
    ]);
    expect(r.query!.linkFieldIds).toEqual(['ftPayee']);
  });

  it('never reads a secret-looking field, and skips excluded tables', () => {
    const r = resolve('knowledge', dataCentreSchema(DATA_CENTRE_SCHEMA, ['tblKnowledges']));
    expect(r.missing).toEqual(['knowledges']);
    expect(tableOf(r, 'tblKnowledgeType')).toMatchObject({ hierarchyFieldId: 'ktParent' });
    expect(JSON.stringify(r.query)).not.toMatch(/ktCredentials/);
  });
});

describe('encodeOverview', () => {
  it('draws WORK: goals over projects over tasks, people and references only where linked', () => {
    const r = resolve('work');
    const out = encodeOverview(
      r,
      graph(
        [
          rec('tblGoals', 'G1', 'Ship the agent', null, active('g', { gDeadline: '2026-10-01' })),
          none('pGoal', 'tblProjects'),
          rec('tblProjects', 'P1', 'Cockpit', 'rec:G1', active('p', { pProgress: 'in-progress' })),
          rec(
            'tblProjects',
            'P2',
            'Loose',
            'grp:pGoal:__none__',
            active('p', { pProgress: 'backlog' })
          ),
          rec('tblTasks', 'T1', 'Board', 'rec:P1', active('t', { tProgress: 'closed' })),
          rec(
            'tblTasks',
            'T2',
            'Voice',
            'rec:P1',
            active('t', { tProgress: 'in-progress', tPriority: 'urgent' })
          ),
          rec('tblTasks', 'T3', 'Old', 'rec:P1', { tActive: false, tProgress: 'backlog' }),
          rec('tblContacts', 'C1', 'Ava', null, active('c')),
          rec('tblContacts', 'C2', 'Bo', null, active('c')),
          rec(
            'tblKnowledges',
            'K1',
            'D3 notes',
            null,
            active('k', { kUpdated: '2026-10-28T00:00:00Z' })
          ),
          rec('tblKnowledges', 'K2', 'Unread', null, active('k')),
        ],
        [edge('T2', 'C1', 'tAssigned'), edge('P1', 'K1', 'pRefer'), edge('C2', 'K2', 'cOther')]
      ),
      now
    );
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get('rec:G1')).toMatchObject({ kind: 'hub', alert: true, short: 'GOAL' });
    expect(byId.get('rec:P2')?.parent).toBe('hub:tblProjects');
    expect(byId.get('hub:tblProjects')?.label).toBe('PROJECTS · NO GOAL');
    expect(byId.get('rec:T2')).toMatchObject({ tone: 'route', size: 4, state: 'in-progress' });
    expect(byId.get('rec:T1')?.tone).toBe('ink');
    expect(byId.get('rec:C1')).toMatchObject({ kind: 'actor', parent: 'hub:tblContacts' });
    expect(byId.get('rec:K1')).toMatchObject({
      kind: 'item',
      tone: 'route',
      parent: 'hub:tblKnowledges',
    });
    // archived, unlinked satellites, and the edge of a field the dataset does not draw: gone
    expect(['rec:T3', 'rec:C2', 'rec:K2'].filter((id) => byId.has(id))).toEqual([]);
    expect(out.links.map((l) => [l.id, l.label, l.tone])).toEqual([
      ['rec:C1|rec:T2', 'assigned_to', 'route'],
      ['rec:K1|rec:P1', 'refer_knowledge', 'route'],
    ]);
    expect(out.counts).toMatchObject({
      goals: 1,
      projects: 2,
      tasks: 2,
      contacts: 1,
      knowledges: 1,
    });
  });

  it('settles a goal whose work is all settled, so its passed deadline is no alert', () => {
    const out = encodeOverview(
      resolve('work'),
      graph([
        rec('tblGoals', 'G1', 'Done goal', null, active('g', { gDeadline: '2026-01-01' })),
        rec('tblProjects', 'P1', 'Shipped', 'rec:G1', active('p', { pProgress: 'finalized' })),
      ]),
      now
    );
    expect(out.nodes.find((n) => n.id === 'rec:G1')?.alert).toBeUndefined();
  });

  it('draws PEOPLE under their type, keeps people without open work, counts work no one has', () => {
    const out = encodeOverview(
      resolve('people'),
      graph(
        [
          rec('tblContactType', 'TY1', 'Team', null, active('ct')),
          rec('tblContactType', 'TY2', 'Nobody here', null, active('ct')),
          none('cType', 'tblContacts'),
          rec('tblContacts', 'C1', 'Ava', 'rec:TY1', active('c')),
          rec('tblContacts', 'C2', 'Bo', 'grp:cType:__none__', active('c')),
          none('tAssigned', 'tblTasks'),
          rec('tblTasks', 'T1', 'Voice', 'rec:C1', active('t', { tProgress: 'in-progress' })),
          rec(
            'tblTasks',
            'T2',
            'Nobody',
            'grp:tAssigned:__none__',
            active('t', { tProgress: 'backlog' })
          ),
          rec('tblProfession', 'PR1', 'Engineer', null, active('pr')),
          rec('tblProfession', 'PR2', 'Unused', null, active('pr')),
        ],
        [edge('C2', 'PR1', 'cProfession')]
      ),
      now
    );
    const parent = (id: string) => out.nodes.find((n) => n.id === id)?.parent;
    expect(parent('rec:C1')).toBe('rec:TY1');
    expect(parent('rec:C2')).toBe('hub:tblContacts');
    expect(out.nodes.find((n) => n.id === 'hub:tblContacts')?.label).toBe('NO TYPE');
    expect(parent('rec:PR1')).toBe('hub:tblProfession');
    expect(out.nodes.map((n) => n.id)).not.toEqual(
      expect.arrayContaining(['rec:TY2', 'rec:PR2', 'rec:T2'])
    );
    expect(out.counts).toMatchObject({ contacts: 2, tasks: 1 });
    expect(out.counts['tasks.unplaced']).toBe(1);
  });

  it('colours FINANCE by type and carries the amount', () => {
    const out = encodeOverview(
      resolve('finance'),
      graph([
        rec('tblCategories', 'CAT', 'Food'),
        rec('tblTransactions', 'X1', 'Lunch', 'rec:CAT', {
          ftType: 'Expense',
          ftAmount: 23.5,
          ftDate: '2026-10-20',
        }),
        rec('tblTransactions', 'X2', 'Pay', 'rec:CAT', {
          ftType: 'Income',
          ftAmount: 4000,
          ftDate: '2026-10-15',
        }),
      ]),
      now
    );
    const x = (id: string) => out.nodes.find((n) => n.id === id);
    expect(x('rec:X1')).toMatchObject({ tone: 'route', amount: 23.5, date: '2026-10-20' });
    expect(x('rec:X2')?.tone).toBe('target');
    expect(x('rec:X2')!.size!).toBeGreaterThan(x('rec:X1')!.size!);
    expect(x('rec:CAT')?.kind).toBe('hub');
  });
});
