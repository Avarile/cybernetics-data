/* eslint-disable sonarjs/no-duplicate-string */
import type { ISearchEventSink, ISearchLogPort, ISearchReaderPort } from '../../domain/ports';
import { DATA_CENTRE_TABLES } from '../../domain/search/__fixtures__/data-centre';
import { buildPlan } from '../../domain/search/planner';
import { RelationGraph } from '../../domain/search/relation-graph';
import type { IFieldRecord, ITableSchema } from '../../domain/search/schema';
import { RunSearch } from './run-search.usecase';

const graph = new RelationGraph(DATA_CENTRE_TABLES);
const rows: Record<string, IFieldRecord[]> = {
  tblProjects: [
    {
      id: 'recP1',
      fields: {
        title: 'Cybernetics Cockpit',
        progress: 'in-progress',
        is_active: true,
        tasks: [
          { id: 'recT1', title: 'Board' },
          { id: 'recT2', title: 'Voice' },
          { id: 'recT3', title: 'Old' },
        ],
        lead_by: { id: 'recC1', title: 'Ava' },
        refer_knowledge: [{ id: 'recK1', title: 'D3 notes' }],
        belong_goals: { id: 'recG1', title: 'Ship the agent' },
      },
    },
    { id: 'recP2', fields: { title: 'Cockpit theme', progress: 'backlog', is_active: true } },
  ],
  tblTasks: [
    {
      id: 'recT1',
      fields: {
        title: 'Board',
        progress: 'in-progress',
        is_active: true,
        assigned_to: { id: 'recC2', title: 'Bo' },
      },
    },
    {
      id: 'recT2',
      fields: {
        title: 'Voice',
        progress: 'closed',
        is_active: true,
        assigned_to: { id: 'recC1', title: 'Ava' },
      },
    },
    { id: 'recT3', fields: { title: 'Old', progress: 'cancelled' } },
  ],
  tblContacts: [
    { id: 'recC1', fields: { title: 'Ava', is_active: true } },
    { id: 'recC2', fields: { title: 'Bo', is_active: true } },
  ],
  tblKnowledges: [{ id: 'recK1', fields: { title: 'D3 notes', is_active: true } }],
  tblGoals: [{ id: 'recG1', fields: { title: 'Ship the agent', is_active: true } }],
};
const of = (t: ITableSchema) => rows[t.id] ?? [];

const reader: ISearchReaderPort = {
  titleMatches: async (t, text) =>
    of(t).filter((r) => String(r.fields.title).toLowerCase().includes(text.toLowerCase())),
  fullText: async () => [],
  quickSearch: async () => [],
  byIds: async (t, ids) =>
    ids.map((id) => of(t).find((r) => r.id === id)).filter(Boolean) as IFieldRecord[],
  filter: async (t) => ({ records: of(t), total: of(t).length }),
  linkedTo: async () => [],
  totals: async () => ({}),
};

const setup = () => {
  const log = { save: vi.fn(async () => undefined) } as unknown as ISearchLogPort;
  const events: string[] = [];
  const sink: ISearchEventSink = {
    plan: (p) => events.push(`plan:${p.status}`),
    step: (p) => events.push(`step:${p.state.stepId}:${p.state.status}`),
    hit: (p) => events.push(`hit:${p.card.key}`),
    lens: vi.fn(),
    clarify: vi.fn(),
  };
  return { runner: new RunSearch(reader, log), log, events, sink };
};
const plan = (text: string) =>
  buildPlan(
    { searchId: 'srch1', intent: 'project_progress', anchor: { text } },
    { graph, baseId: 'bseDataCentre' }
  );

describe('RunSearch', () => {
  it('runs the project-progress plan step by step, card by card (§6.3)', async () => {
    const { runner, log, events, sink } = setup();
    const result = await runner.run({
      plan: plan('Cybernetics Cockpit'),
      graph,
      single: true,
      events: sink,
    });
    expect(result.status).toBe('done');
    expect(events).toEqual([
      'plan:running',
      'step:s1:running',
      'hit:s1:recP1',
      'step:s1:done',
      'plan:running',
      'step:s2:running',
      'hit:s2:recT1',
      'hit:s2:recT2',
      'step:s2:done',
      'plan:running',
      'step:s3:running',
      'hit:s3:recC2',
      'hit:s3:recC1',
      'step:s3:done',
      'plan:running',
      'step:s4:running',
      'hit:s4:recK1',
      'step:s4:done',
      'plan:running',
      'step:s5:running',
      'hit:s5:recG1',
      'step:s5:done',
      'plan:running',
      'plan:done',
    ]);
    // the cancelled, inactive task is left out; people come with how they were reached
    expect(result.states.map((s) => [s.stepId, s.found, s.shown])).toEqual([
      ['s1', 1, 1],
      ['s2', 2, 2],
      ['s3', 2, 2],
      ['s4', 1, 1],
      ['s5', 1, 1],
    ]);
    expect(result.cards.find((c) => c.key === 's3:recC2')!.via).toEqual({
      stepId: 's2',
      recordId: 'recT1',
      field: 'assigned_to',
    });
    expect(log.save).toHaveBeenCalledTimes(6);
    const forModel = result.forModel as { steps: { records: unknown[] }[]; next: string };
    expect(forModel.steps[1].records).toEqual([
      {
        id: 'recT1',
        title: 'Board',
        state: 'in-progress',
        assigned_to: 'Bo',
        via: 'tasks of recP1',
      },
      { id: 'recT2', title: 'Voice', state: 'closed', assigned_to: 'Ava', via: 'tasks of recP1' },
    ]);
    expect(forModel.next).toMatch(/highlight_records/);
  });

  it('stops for a choice when several projects match', async () => {
    const { runner, events, sink } = setup();
    const result = await runner.run({ plan: plan('cockpit'), graph, single: true, events: sink });
    expect(result.status).toBe('needs_choice');
    expect(result.states.map((s) => s.status)).toEqual([
      'needs_choice',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(events.filter((e) => e.startsWith('hit'))).toEqual(['hit:s1:recP1', 'hit:s1:recP2']);
    expect((result.forModel as { next: string }).next).toMatch(/Call clarify/);
  });

  it('says when nothing matched, and stops on abort', async () => {
    const { runner } = setup();
    expect((await runner.run({ plan: plan('nothing like it'), graph, single: true })).status).toBe(
      'empty'
    );
    const controller = new AbortController();
    controller.abort();
    const stopped = await runner.run({
      plan: plan('Cybernetics Cockpit'),
      graph,
      single: true,
      signal: controller.signal,
    });
    expect(stopped.status).toBe('cancelled');
    expect(stopped.cards).toEqual([]);
  });
});
