/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Cockpit design §6–§7 end to end: plan_search over real tables with links, the turn protocol
 * with a scripted model (data tools hidden until a plan ran, clarify forced after an ambiguous
 * anchor), the stream parts, the stored search and its replay.
 */
import { FieldType, Relationship } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAgentSearchVo, ISearchCard } from '@teable/openapi';
import { getAgentSearch } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { RunTurn } from '../src/features/agent/application/chat/run-turn.usecase';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { GetSearch } from '../src/features/agent/application/search/get-search.query';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  type IAgentStorePort,
  type IModelPort,
  type ISearchEventSink,
} from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { InvestigateToolkit } from '../src/features/agent/toolkits/investigate/investigate.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import type { IClsStore } from '../src/types/cls';
import { call, drain, say, scriptedModel, type IScript } from './utils/agent-script';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  getFields,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

describe('Agent search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: IAgentStorePort;
  let home: IAgentInstallationView;
  let baseId: string;
  let current: ReturnType<typeof scriptedModel>;
  const ids: Record<string, string> = {};
  const adminId = () => globalThis.testConfig.userId;

  const asAgent = <T>(fn: () => Promise<T>) =>
    app.get(AgentExecutionContext).run({ runId: 'e2e-search', actorUserId: adminId() }, fn);
  const sinkLog = () => {
    const events: string[] = [];
    const sink: ISearchEventSink = {
      plan: (p) => events.push(`plan:${p.status}`),
      step: (p) => events.push(`step:${p.state.stepId}:${p.state.status}`),
      hit: (p) => events.push(`hit:${p.card.stepId}:${p.card.title}`),
      lens: (p) => events.push(`lens:${p.recordKeys.length}`),
      clarify: (p) => events.push(`clarify:${p.options.length}`),
    };
    return { events, sink };
  };
  const planSearch = async (input: Record<string, unknown>, sink?: ISearchEventSink) => {
    const tool = app.get(InvestigateToolkit).tools.find((t) => t.name === 'plan_search')!;
    const profile = (await asAgent(() => store.getDefaultProfile())) as IAgentProfile;
    const thread = await asAgent(() =>
      store.createThread({ title: 'search', ownerId: adminId(), profileId: profile.id })
    );
    const ctx: IToolContext = {
      runId: `run-${Math.random()}`,
      actorUserId: adminId(),
      threadId: thread.id,
      profile,
      events: sink,
    };
    return asAgent(() =>
      (tool.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
        tool.input.parse(input),
        ctx
      )
    ) as Promise<{
      searchId: string;
      status: string;
      steps: {
        step: string;
        table: string;
        status: string;
        found: number;
        records: { title: string }[];
      }[];
    }>;
  };
  const play = (scripts: IScript[]) => {
    current = scriptedModel(scripts);
  };
  const toolNames = (i: number) =>
    (current.model.doStreamCalls[i]?.tools ?? []).map((t) => (t as { name: string }).name);

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    const base = await createBase({ spaceId: globalThis.testConfig.spaceId, name: 'search e2e' });
    baseId = base.id;

    const active = { name: 'is_active', type: FieldType.Checkbox };
    const progress = (choices: string[]) => ({
      name: 'progress',
      type: FieldType.SingleSelect,
      options: { choices: choices.map((name) => ({ name })) },
    });
    const contacts = await createTable(baseId, {
      name: 'contacts',
      fields: [{ name: 'title', type: FieldType.SingleLineText }, active],
      records: [
        { fields: { title: 'Ava', is_active: true } },
        { fields: { title: 'Bo', is_active: true } },
      ],
    });
    const knowledges = await createTable(baseId, {
      name: 'knowledges',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
        active,
      ],
      records: [
        {
          fields: { title: 'D3 notes', context: 'Radial trees with d3.cluster.', is_active: true },
        },
      ],
    });
    const goals = await createTable(baseId, {
      name: 'goals',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'deadline', type: FieldType.Date },
        active,
      ],
      records: [{ fields: { title: 'Ship the agent', deadline: '2026-01-01', is_active: true } }],
    });
    const projects = await createTable(baseId, {
      name: 'projects',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        progress(['backlog', 'in-progress', 'finalized']),
        active,
      ],
    });
    const tasks = await createTable(baseId, {
      name: 'tasks',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        progress(['backlog', 'in-progress', 'closed', 'cancelled']),
        {
          name: 'priority',
          type: FieldType.SingleSelect,
          options: { choices: [{ name: 'urgent' }, { name: 'normal' }] },
        },
        active,
      ],
    });
    const link = (
      name: string,
      foreignTableId: string,
      relationship: Relationship,
      isOneWay = false
    ) => ({
      name,
      type: FieldType.Link,
      options: { relationship, foreignTableId, ...(isOneWay ? { isOneWay } : {}) },
    });
    await createField(projects.id, link('belong_goals', goals.id, Relationship.ManyOne));
    await createField(projects.id, link('lead_by', contacts.id, Relationship.ManyOne));
    await createField(
      projects.id,
      link('refer_knowledge', knowledges.id, Relationship.ManyMany, true)
    );
    await createField(tasks.id, link('belong_project', projects.id, Relationship.ManyOne));
    await createField(tasks.id, link('assigned_to', contacts.id, Relationship.ManyOne));
    await createField(
      tasks.id,
      link('refer_knowledge', knowledges.id, Relationship.ManyMany, true)
    );
    // the back-links the recipes follow must be called tasks (on projects and contacts)
    for (const table of [projects.id, contacts.id]) {
      const back = (await getFields(table)).find(
        (f) =>
          f.type === FieldType.Link &&
          (f.options as { foreignTableId: string }).foreignTableId === tasks.id
      );
      if (back && back.name !== 'tasks')
        await prisma.field.update({ where: { id: back.id }, data: { name: 'tasks' } });
    }

    const recs = async (tableId: string, records: Record<string, unknown>[]) =>
      (
        await createRecords(tableId, {
          typecast: true,
          records: records.map((fields) => ({ fields })),
        })
      ).records;
    ids.ava = contacts.records[0].id;
    ids.bo = contacts.records[1].id;
    ids.d3 = knowledges.records[0].id;
    ids.goal = goals.records[0].id;
    const [p1, p2] = await recs(projects.id, [
      {
        title: 'Cybernetics Cockpit',
        progress: 'in-progress',
        is_active: true,
        belong_goals: { id: ids.goal },
        lead_by: { id: ids.ava },
        refer_knowledge: [{ id: ids.d3 }],
      },
      { title: 'Cockpit theme', progress: 'backlog', is_active: true },
    ]);
    ids.p1 = p1.id;
    ids.p2 = p2.id;
    const [t1, t2, t3] = await recs(tasks.id, [
      {
        title: 'Board',
        progress: 'in-progress',
        priority: 'urgent',
        is_active: true,
        belong_project: { id: p1.id },
        assigned_to: { id: ids.bo },
      },
      {
        title: 'Voice',
        progress: 'closed',
        is_active: true,
        belong_project: { id: p1.id },
        assigned_to: { id: ids.ava },
        refer_knowledge: [{ id: ids.d3 }],
      },
      { title: 'Old', progress: 'cancelled', belong_project: { id: p1.id } },
    ]);
    ids.t1 = t1.id;
    ids.t2 = t2.id;
    ids.t3 = t3.id;

    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    const profile = await asAgent(() => store.getDefaultProfile());
    await asAgent(() =>
      store.updateProfile(profile!.id, {
        model: 'mock/scripted',
        toolkits: ['data_read'],
        dataBaseId: baseId,
      })
    );
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'resolve').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model: current.model,
    }));
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId).catch(() => undefined);
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('runs the project-progress plan table by table, card by card (§6.3)', async () => {
    const { events, sink } = sinkLog();
    const out = await planSearch(
      { intent: 'project_progress', anchor: { text: 'Cybernetics Cockpit' } },
      sink
    );
    expect(out.status).toBe('done');
    expect(out.steps.map((s) => [s.table, s.status, s.found])).toEqual([
      ['projects', 'done', 1],
      ['tasks', 'done', 2],
      ['contacts', 'done', 2],
      ['knowledges', 'done', 1],
      ['goals', 'done', 1],
    ]);
    // link cells keep no fixed order: lanes fill in plan order, cards in the order links give them
    expect(out.steps[1].records.map((r) => r.title).sort()).toEqual(['Board', 'Voice']);
    const hits = events.filter((e) => e.startsWith('hit'));
    expect(hits.map((e) => e.split(':')[1])).toEqual(['s1', 's2', 's2', 's3', 's3', 's4', 's5']);
    expect(hits.map((e) => e.split(':')[2]).sort()).toEqual(
      ['Cybernetics Cockpit', 'Board', 'Voice', 'Bo', 'Ava', 'D3 notes', 'Ship the agent'].sort()
    );
    expect(events[0]).toBe('plan:running');
    expect(events.at(-1)).toBe('plan:done');

    const stored = await app.get(GetSearch).get(adminId(), out.searchId);
    expect(stored.status).toBe('done');
    expect(stored.cards).toHaveLength(7);
    const goal = stored.cards.find((c) => c.stepId === 's5') as ISearchCard;
    expect(goal).toMatchObject({ title: 'Ship the agent', alert: true });
  });

  it('follows one-way links backwards for a knowledge lookup', async () => {
    const out = await planSearch({ intent: 'knowledge_lookup', anchor: { text: 'D3' } });
    expect(out.steps.map((s) => [s.table, s.status, s.records.map((r) => r.title)])).toEqual([
      ['knowledges', 'done', ['D3 notes']],
      ['projects', 'done', ['Cybernetics Cockpit']],
      ['tasks', 'done', ['Voice']],
    ]);
    // this base has no related or parent links on knowledges: that step is skipped and listed
    expect((out as unknown as { missing: string[] }).missing).toEqual([
      'knowledges.related_knowledge',
      'knowledges.knowledge_parent',
    ]);
  });

  it('hides data tools until a plan ran, streams the search and keeps the plan in the message', async () => {
    play([
      call('plan_search', { intent: 'project_progress', anchor: { text: 'Cybernetics Cockpit' } }),
      call('highlight_records', { records: [ids.t1] }),
      say('Board is in progress.'),
    ]);
    const turn = await app
      .get(RunTurn)
      .execute(adminId(), { message: { text: 'How is the cockpit project?' } });
    const { chunks } = await drain(turn.stream);
    expect(toolNames(0)).toEqual(expect.arrayContaining(['plan_search', 'clarify']));
    expect(toolNames(0)).not.toContain('query_records');
    expect(toolNames(0)).not.toContain('highlight_records');
    expect(toolNames(1)).toEqual(expect.arrayContaining(['query_records', 'highlight_records']));

    const types = chunks.map((c) => c.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'data-search-plan',
        'data-search-step',
        'data-search-hit',
        'data-search-lens',
      ])
    );
    expect(types.filter((t) => t === 'data-search-hit')).toHaveLength(7);
    const [, reply] = await store.listMessages(turn.threadId);
    expect(reply.parts).toContain('data-search-plan');
    expect(reply.parts).toContain('data-search-lens');
    expect(reply.parts).not.toContain('data-search-hit');
    const lens = JSON.parse(reply.parts!).find(
      (p: { type: string }) => p.type === 'data-search-lens'
    );
    expect(lens.data.recordKeys).toEqual([`s2:${ids.t1}`]);
  });

  it('asks when several projects match, then plans with the picked one', async () => {
    play([
      call('plan_search', { intent: 'project_progress', anchor: { text: 'cockpit' } }),
      call('clarify', { question: 'Which project?', reason: 'anchor' }),
      say('(never reached)'),
    ]);
    const turn = await app
      .get(RunTurn)
      .execute(adminId(), { message: { text: 'How is cockpit going?' } });
    const { chunks } = await drain(turn.stream);
    expect(current.model.doStreamCalls).toHaveLength(2);
    expect(current.model.doStreamCalls[1].toolChoice).toEqual({
      type: 'tool',
      toolName: 'clarify',
    });
    const clarify = chunks.find((c) => c.type === 'data-clarify') as unknown as {
      data: {
        clarifyId: string;
        options: { id: string; label: string; recordRef?: { recordId: string } }[];
      };
    };
    expect(clarify.data.options.map((o) => [o.label, o.recordRef?.recordId])).toEqual(
      expect.arrayContaining([
        ['Cybernetics Cockpit', ids.p1],
        ['Cockpit theme', ids.p2],
      ])
    );

    const picked = clarify.data.options.find((o) => o.recordRef?.recordId === ids.p1)!;
    play([say('Here it is.')]);
    const next = await app.get(RunTurn).execute(adminId(), {
      threadId: turn.threadId,
      message: {
        text: 'The first one',
        choice: { clarifyId: clarify.data.clarifyId, optionId: picked.id, label: 'forged' },
      },
    });
    await drain(next.stream);
    const messages = await store.listMessages(turn.threadId);
    const choice = JSON.parse(messages[2].parts!).find(
      (p: { type: string }) => p.type === 'data-choice'
    );
    expect(choice.data).toMatchObject({
      label: 'Cybernetics Cockpit',
      recordRef: { recordId: ids.p1 },
    });
    expect(JSON.stringify(current.prompts[0])).toContain(
      `[The admin picked the option \\"Cybernetics Cockpit\\": projects ${ids.p1}]`
    );
  });

  it('serves stored searches to their owner only', async () => {
    const out = await planSearch({ intent: 'task_lookup', anchor: { text: 'Board' } });
    const vo: IAgentSearchVo = await getAgentSearch(out.searchId);
    expect(vo).toMatchObject({ id: out.searchId, intent: 'task_lookup', status: 'done' });
    expect(vo.cards.map((c) => c.title)).toEqual(expect.arrayContaining(['Board', 'Bo']));
    expect((await getError(() => getAgentSearch('srchNope')))?.status).toBe(404);
    await expect(app.get(GetSearch).get('usrSomeoneElse', out.searchId)).rejects.toThrow(
      'Search not found'
    );
  });
});
