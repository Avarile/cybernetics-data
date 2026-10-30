/* eslint-disable sonarjs/no-duplicate-string */
import { DATA_CENTRE_TABLES } from './__fixtures__/data-centre';
import { chooseAnchor, isExactTitle } from './anchor-choice';
import { cellText, plainText, projectCard, shortName } from './card-projection';
import { openFirst, tallyOf } from './card-tally';
import { buildPlan, PlanError } from './planner';
import { RelationGraph } from './relation-graph';
import type { ISearchCard, ISearchTone } from './search.types';
import { sizeOfPriority, toneOf } from './tone';
import { phaseAfter, stepTools } from './turn-protocol';

const graph = new RelationGraph(DATA_CENTRE_TABLES);
const ctx = { graph, baseId: 'bseDataCentre' };
const plan = (req: Partial<Parameters<typeof buildPlan>[0]>) =>
  buildPlan({ searchId: 'srch1', intent: 'project_progress', ...req }, ctx);

describe('buildPlan', () => {
  it('makes the project-progress plan of the design (§6.3)', () => {
    const p = plan({ anchor: { text: 'Cybernetics Cockpit' } });
    expect(p.steps.map((s) => [s.id, s.table.name, s.role])).toEqual([
      ['s1', 'projects', 'anchor'],
      ['s2', 'tasks', 'related'],
      ['s3', 'contacts', 'actor'],
      ['s4', 'knowledges', 'related'],
      ['s5', 'goals', 'context'],
    ]);
    expect(p.steps[0].source).toEqual({
      kind: 'search',
      text: 'Cybernetics Cockpit',
      filter: undefined,
    });
    expect(p.steps[2].source).toEqual({
      kind: 'follow',
      from: [
        { stepId: 's2', field: 'assigned_to' },
        { stepId: 's1', field: 'lead_by' },
      ],
    });
    expect(p.missing).toEqual([]);
    expect(p.summary).toBe('project progress "Cybernetics Cockpit"');
  });

  it('pins the anchor to chosen records', () => {
    const p = plan({ anchor: { recordIds: ['recA'] }, summary: 'Progress of A' });
    expect(p.steps[0].source).toEqual({ kind: 'records', recordIds: ['recA'] });
    expect(p.summary).toBe('Progress of A');
  });

  it('skips what the base lacks and lists it', () => {
    const tables = DATA_CENTRE_TABLES.filter((t) => t.name !== 'goals').map((t) =>
      t.name === 'tasks' ? { ...t, fields: t.fields.filter((f) => f.name !== 'assigned_to') } : t
    );
    const p = buildPlan(
      { searchId: 's', intent: 'project_progress', anchor: { text: 'x' } },
      { graph: new RelationGraph(tables), baseId: 'b' }
    );
    expect(p.steps.map((s) => s.table.name)).toEqual([
      'projects',
      'tasks',
      'contacts',
      'knowledges',
    ]);
    expect(p.steps[2].source).toEqual({
      kind: 'follow',
      from: [{ stepId: 's1', field: 'lead_by' }],
    });
    expect(p.missing).toEqual(['tasks.assigned_to', 'goals']);
  });

  it('uses reverse links for knowledge lookups', () => {
    const p = plan({ intent: 'knowledge_lookup', anchor: { text: 'docker' } });
    expect(p.steps[2]).toMatchObject({
      table: { name: 'projects' },
      source: { kind: 'reverse', from: [{ stepId: 's1', field: 'refer_knowledge' }] },
    });
    expect(p.steps[0].limit).toBe(25);
  });

  it('adds one hop per linked table for a record lookup', () => {
    const p = plan({ intent: 'record_lookup', anchor: { table: 'tasks', text: 'tts' } });
    expect(p.steps.map((s) => s.table.name)).toEqual([
      'tasks',
      'contacts',
      'projects',
      'knowledges',
    ]);
  });

  it('refuses an anchor table the recipe does not start from, and unknown or system tables', () => {
    expect(() => plan({ anchor: { table: 'tasks', text: 'x' } })).toThrow(PlanError);
    expect(() => plan({ intent: 'record_lookup', anchor: { table: 'nope', text: 'x' } })).toThrow(
      /No table "nope"/
    );
    expect(() =>
      plan({ intent: 'record_lookup', anchor: { table: 'system_info', text: 'x' } })
    ).toThrow(/not searched/);
    expect(() => plan({ anchor: {} })).toThrow(/Give the anchor/);
  });

  it('validates custom steps and names the links', () => {
    const p = plan({
      intent: 'custom',
      steps: [
        { table: 'contacts', search: 'Alice' },
        { table: 'tasks', follow: [{ step: 's1', field: 'tasks' }] },
        { table: 'projects', reverse: [{ step: 's1', field: 'lead_by' }] },
      ],
    });
    expect(p.steps.map((s) => s.source.kind)).toEqual(['search', 'follow', 'reverse']);
    expect(() =>
      plan({
        intent: 'custom',
        steps: [
          { table: 'projects', search: 'x' },
          { table: 'tasks', follow: [{ step: 's1', field: 'lead_by' }] },
        ],
      })
    ).toThrow(/projects\.lead_by is not a link projects → tasks\. projects links: tasks → tasks/);
    expect(() =>
      plan({ intent: 'custom', steps: [{ table: 'tasks', follow: [{ step: 's2', field: 'x' }] }] })
    ).toThrow(/not an earlier step/);
  });
});

describe('chooseAnchor', () => {
  const hit = (recordId: string, title: string, rank?: number, exact = false) => ({
    recordId,
    title,
    rank,
    exact,
  });
  it('goes on with a clear winner', () => {
    expect(chooseAnchor([hit('a', 'A', 1, true), hit('b', 'AB', 5)], true)).toEqual({
      kind: 'chosen',
      recordIds: ['a'],
    });
    expect(chooseAnchor([hit('a', 'A')], true)).toEqual({ kind: 'chosen', recordIds: ['a'] });
    expect(chooseAnchor([hit('a', 'A', 4), hit('b', 'B', 2)], true)).toEqual({
      kind: 'chosen',
      recordIds: ['a'],
    });
  });
  it('asks when it is close, and keeps all for list questions', () => {
    expect(chooseAnchor([hit('a', 'A', 3), hit('b', 'B', 2)], true).kind).toBe('needs_choice');
    expect(chooseAnchor([hit('a', 'A', 0, true), hit('b', 'a', 0, true)], true)).toMatchObject({
      kind: 'needs_choice',
      candidates: [{ recordId: 'a' }, { recordId: 'b' }],
    });
    expect(chooseAnchor([hit('a', 'A', 3), hit('b', 'B', 2)], false)).toEqual({
      kind: 'chosen',
      recordIds: ['a', 'b'],
    });
    expect(chooseAnchor([], true)).toEqual({ kind: 'empty' });
  });
  it('compares titles loosely', () => {
    expect(isExactTitle(' Cybernetics  cockpit', 'cybernetics cockpit')).toBe(true);
  });
});

describe('projectCard', () => {
  const tasks = graph.table('tasks')!;
  const now = new Date('2026-10-30T00:00:00Z');
  it('encodes a task like the cockpit', () => {
    const card = projectCard({
      record: {
        id: 'rec1',
        fields: {
          title: 'Wire the TTS endpoint',
          context: '## Plan\nStream **audio/mpeg** from [ElevenLabs](https://x).',
          progress: 'in-progress',
          priority: 'urgent',
          assigned_to: { id: 'recP', title: 'Alice' },
          belong_project: { id: 'recProj', title: 'Cockpit' },
          refer_knowledge: [{ id: 'recK', title: 'TTS notes' }],
          started_at: '2026-10-20T00:00:00.000Z',
          is_active: true,
          id: 42,
        },
      },
      table: tasks,
      step: { id: 's2' },
      via: { stepId: 's1', recordId: 'recProj', field: 'tasks' },
      now,
    });
    expect(card).toMatchObject({
      key: 's2:rec1',
      short: 'TASK · #42',
      title: 'Wire the TTS endpoint',
      tone: 'route',
      state: 'in-progress',
      size: 4,
      snippet: 'Plan Stream audio/mpeg from ElevenLabs.',
      date: '2026-10-20',
      links: { assigned_to: ['recP'], belong_project: ['recProj'], refer_knowledge: ['recK'] },
    });
    expect(card.fields).toEqual([
      { name: 'priority', value: 'urgent' },
      { name: 'assigned_to', value: 'Alice' },
      { name: 'belong_project', value: 'Cockpit' },
      { name: 'started_at', value: '2026-10-20' },
    ]);
    expect(card.archived).toBeUndefined();
  });

  it('marks archived records and passed deadlines, and hides secrets', () => {
    const goal = projectCard({
      record: { id: 'g', fields: { title: 'G', deadline: '2026-10-01', is_active: true } },
      table: graph.table('goals')!,
      step: { id: 's5' },
      now,
    });
    expect(goal.alert).toBe(true);
    const contact = projectCard({
      record: { id: 'c', fields: { title: 'Alice', email: 'a@x', api_key: 'sk-1' } },
      table: graph.table('contacts')!,
      step: { id: 's3' },
      now,
    });
    expect(contact.archived).toBe(true);
    expect(contact.tone).toBe('faint');
    expect(contact.fields).toEqual([{ name: 'email', value: 'a@x' }]);
  });

  it('formats cells and names', () => {
    expect(
      cellText([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
    ).toBe('A, B');
    expect(cellText('2026-10-20T10:00:00.000Z')).toBe('2026-10-20');
    expect(plainText('# T\n\n- a `b`')).toBe('T - a b');
    expect(shortName('finance_Transactions')).toBe('TRANSACTION');
    expect(shortName('knowledges')).toBe('KNOWLEDGE');
    expect(toneOf('finished_reviewing')).toBe('ink');
    expect(toneOf('onhold')).toBe('caution');
    // negated words are open work, not the state they negate
    expect(['not started', 'Not_Done', 'incomplete', 'unfinished'].map(toneOf)).toEqual([
      'target',
      'target',
      'target',
      'target',
    ]);
    expect([toneOf('invalid'), toneOf('validated'), toneOf('started')]).toEqual([
      'none',
      'ink',
      'route',
    ]);
    expect(sizeOfPriority('can wait')).toBe(1);
  });
});

describe('openFirst and tallyOf', () => {
  const card = (id: string, tone: ISearchTone, state?: string, alert?: boolean): ISearchCard => ({
    key: `s2:${id}`,
    stepId: 's2',
    recordId: id,
    tableId: 'tblTasks',
    table: 'tasks',
    title: id,
    short: null,
    tone,
    fields: [],
    ...(state ? { state } : {}),
    ...(alert ? { alert } : {}),
  });
  const cards = [
    card('a', 'ink', 'closed'),
    card('b', 'faint', 'cancelled'),
    card('c', 'dim', 'backlog'),
    card('d', 'route', 'in-progress'),
    card('e', 'ink', 'closed'),
    card('f', 'dim', 'backlog', true),
    card('g', 'none'),
  ];

  it('puts overdue and open work first, keeping link order within a state', () => {
    expect(openFirst(cards).map((c) => c.recordId)).toEqual(['f', 'd', 'c', 'g', 'a', 'e', 'b']);
  });

  it('counts every state, and none for a table without one', () => {
    expect(tallyOf(cards)).toEqual({
      counted: 7,
      overdue: 1,
      states: [
        { state: 'in-progress', tone: 'route', count: 1 },
        { state: 'backlog', tone: 'dim', count: 2 },
        { state: '', tone: 'none', count: 1 },
        { state: 'closed', tone: 'ink', count: 2 },
        { state: 'cancelled', tone: 'faint', count: 1 },
      ],
    });
    expect(tallyOf([card('x', 'none'), card('y', 'none')])).toBeUndefined();
  });
});

describe('turn protocol', () => {
  const toolkitOf = new Map([
    ['clarify', 'investigate'],
    ['plan_search', 'investigate'],
    ['highlight_records', 'investigate'],
    ['query_records', 'data_read'],
    ['memory_save', 'memory'],
  ]);
  const plan = (status: string) => ({
    toolName: 'plan_search',
    output: { untrusted_data: { status } },
  });

  it('hides data tools until a plan ran', () => {
    expect(stepTools({ mode: 'plan', start: 'intent', outcomes: [], toolkitOf })).toEqual({
      activeTools: ['clarify', 'plan_search', 'memory_save'],
    });
    expect(
      stepTools({ mode: 'plan', start: 'intent', outcomes: [plan('done')], toolkitOf }).activeTools
    ).toEqual([...toolkitOf.keys()]);
  });

  it('forces clarify after an ambiguous anchor and stops planning after three', () => {
    expect(
      stepTools({ mode: 'plan', start: 'intent', outcomes: [plan('needs_choice')], toolkitOf })
    ).toEqual({
      activeTools: ['clarify'],
      forceTool: 'clarify',
    });
    const three = [plan('empty'), plan('empty'), plan('empty')];
    expect(
      stepTools({ mode: 'plan', start: 'intent', outcomes: three, toolkitOf }).activeTools
    ).toEqual(['clarify', 'memory_save']);
    expect(phaseAfter('intent', [plan('empty')])).toBe('intent');
  });

  it('offers everything in free mode or when resumed', () => {
    expect(stepTools({ mode: 'free', start: 'intent', outcomes: [], toolkitOf })).toEqual({});
    expect(
      stepTools({ mode: 'plan', start: 'answer', outcomes: [], toolkitOf }).activeTools
    ).toHaveLength(5);
  });
});
