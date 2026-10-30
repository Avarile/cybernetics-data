/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Overview design §8 end to end: real tables with links, the agent's data base pinned, each
 * dataset read through the base graph with values, encoded, cached by ETag, admins only.
 */
import { FieldType, Relationship } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { IAgentOverviewVo, IOverviewNode } from '@teable/openapi';
import { AGENT_OVERVIEW, axios, getAgentOverview, urlBuilder } from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import type { IClsStore } from '../src/types/cls';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

describe('Agent overview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: IAgentStorePort;
  let home: IAgentInstallationView;
  let member: AxiosInstance;
  let baseId: string;
  const ids: Record<string, string> = {};
  const adminId = () => globalThis.testConfig.userId;
  const asAgent = <T>(fn: () => Promise<T>) =>
    app.get(AgentExecutionContext).run({ runId: 'e2e-overview', actorUserId: adminId() }, fn);

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    member = await createNewUserAxios({
      email: 'agent-overview-member@example.com',
      password: '12345678',
    });
    baseId = (await createBase({ spaceId: globalThis.testConfig.spaceId, name: 'overview e2e' }))
      .id;

    const active = { name: 'is_active', type: FieldType.Checkbox };
    const title = { name: 'title', type: FieldType.SingleLineText };
    const select = (name: string, choices: string[]) => ({
      name,
      type: FieldType.SingleSelect,
      options: { choices: choices.map((c) => ({ name: c })) },
    });
    const link = (name: string, foreignTableId: string, relationship: Relationship) => ({
      name,
      type: FieldType.Link,
      options: { relationship, foreignTableId },
    });
    const contacts = await createTable(baseId, {
      name: 'contacts',
      fields: [title, active],
      records: [
        { fields: { title: 'Ava', is_active: true } },
        { fields: { title: 'Bo', is_active: true } },
        { fields: { title: 'Cy', is_active: true } },
      ],
    });
    const knowledges = await createTable(baseId, {
      name: 'knowledges',
      fields: [title, active],
      records: [
        { fields: { title: 'D3 notes', is_active: true } },
        { fields: { title: 'Unread', is_active: true } },
      ],
    });
    const goals = await createTable(baseId, {
      name: 'goals',
      fields: [title, { name: 'deadline', type: FieldType.Date }, active],
      records: [{ fields: { title: 'Ship the agent', deadline: '2026-01-01', is_active: true } }],
    });
    const projects = await createTable(baseId, {
      name: 'projects',
      fields: [title, select('progress', ['backlog', 'in-progress', 'finalized']), active],
    });
    const tasks = await createTable(baseId, {
      name: 'tasks',
      fields: [
        title,
        select('progress', ['backlog', 'in-progress', 'closed', 'cancelled']),
        select('priority', ['urgent', 'normal']),
        active,
      ],
    });
    await createField(projects.id, link('belong_goals', goals.id, Relationship.ManyOne));
    await createField(projects.id, link('lead_by', contacts.id, Relationship.ManyOne));
    await createField(projects.id, link('refer_knowledge', knowledges.id, Relationship.ManyMany));
    await createField(tasks.id, link('belong_project', projects.id, Relationship.ManyOne));
    await createField(tasks.id, link('assigned_to', contacts.id, Relationship.ManyOne));

    const recs = async (tableId: string, records: Record<string, unknown>[]) =>
      (
        await createRecords(tableId, {
          typecast: true,
          records: records.map((fields) => ({ fields })),
        })
      ).records;
    const [ava, bo] = contacts.records;
    ids.ava = ava.id;
    ids.bo = bo.id;
    ids.cy = contacts.records[2].id;
    ids.d3 = knowledges.records[0].id;
    ids.unread = knowledges.records[1].id;
    ids.goal = goals.records[0].id;
    const [p1, p2] = await recs(projects.id, [
      {
        title: 'Cockpit',
        progress: 'in-progress',
        is_active: true,
        belong_goals: { id: ids.goal },
        lead_by: { id: ids.ava },
        refer_knowledge: [{ id: ids.d3 }],
      },
      { title: 'Loose', progress: 'backlog', is_active: true },
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
      { title: 'Voice', progress: 'closed', is_active: true, belong_project: { id: p1.id } },
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
    await asAgent(() => store.updateProfile(profile!.id, { dataBaseId: baseId }));
  });

  afterAll(async () => {
    await permanentDeleteBase(baseId).catch(() => undefined);
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  const nodeOf = (vo: IAgentOverviewVo, recordId: string) =>
    vo.nodes.find((n) => n.recordId === recordId) as IOverviewNode;

  it('draws WORK from the pinned base: the tree, tones, people and references where linked', async () => {
    const vo = await getAgentOverview('work');
    expect(vo).toMatchObject({ dataset: 'work', baseId, missing: [] });
    expect(nodeOf(vo, ids.goal)).toMatchObject({ kind: 'hub', alert: true });
    expect(nodeOf(vo, ids.p1)).toMatchObject({ parent: `rec:${ids.goal}`, tone: 'route' });
    expect(nodeOf(vo, ids.p2).parent).toMatch(/^hub:/);
    expect(nodeOf(vo, ids.t1)).toMatchObject({
      parent: `rec:${ids.p1}`,
      tone: 'route',
      size: 4,
      state: 'in-progress',
    });
    expect(nodeOf(vo, ids.t2).tone).toBe('ink');
    // inactive, unlinked person, unreferenced note: not drawn
    for (const gone of [ids.t3, ids.cy, ids.unread]) expect(nodeOf(vo, gone)).toBeUndefined();
    expect(nodeOf(vo, ids.ava).kind).toBe('actor');
    expect(nodeOf(vo, ids.d3).kind).toBe('item');
    expect(vo.links.map((l) => l.label).sort()).toEqual([
      'assigned_to',
      'lead_by',
      'refer_knowledge',
    ]);
  });

  it('names what a dataset lacks, and still draws the rest', async () => {
    const vo = await getAgentOverview('knowledge');
    expect(vo.missing).toEqual(
      expect.arrayContaining([
        'knowledge_type',
        'knowledges.knowledge_parent',
        'knowledges.knowledge_type',
      ])
    );
    expect(nodeOf(vo, ids.d3)?.parent).toMatch(/^hub:/);
  });

  it('answers an unchanged overview with 304, and only admins at all', async () => {
    const url = urlBuilder(AGENT_OVERVIEW, { dataset: 'work' });
    const first = await axios.get(url);
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^".+"$/);
    const again = await axios.get(url, {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      headers: { 'If-None-Match': etag },
      validateStatus: () => true,
    });
    expect(again.status).toBe(304);
    expect((await getError(() => member.get(url)))?.status).toBe(403);
    expect(
      (await getError(() => axios.get(urlBuilder(AGENT_OVERVIEW, { dataset: 'nope' }))))?.status
    ).toBe(400);
  });
});
