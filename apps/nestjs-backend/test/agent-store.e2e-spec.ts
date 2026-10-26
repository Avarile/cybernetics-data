/* eslint-disable sonarjs/no-duplicate-string */
/**
 * AgentTableStore (design §5.3, §7.2): the agent's entities live in the Agent base and are read
 * and written by pack key, so renaming a column in the UI changes nothing for the agent.
 */
import { FieldKeyType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { AGENT_STORE_PORT, type IAgentStorePort } from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { MAX_PARTS_BYTES } from '../src/features/agent/infrastructure/store/agent-table-store';
import { BUILTIN_SKILLS } from '../src/features/agent/pack/builtin-skills';
import { FieldOpenApiService } from '../src/features/field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../src/features/record/open-api/record-open-api.service';
import type { IClsStore } from '../src/types/cls';
import { initApp, runWithTestUser } from './utils/init-app';

describe('AgentTableStore (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let store: IAgentStorePort;
  let home: IAgentInstallationView;
  const adminId = () => globalThis.testConfig.userId;
  const asAgent = <T>(fn: () => Promise<T>) =>
    app.get(AgentExecutionContext).run({ runId: 'e2e', actorUserId: adminId() }, fn);

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
  });

  afterAll(async () => {
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('reads and updates the default profile', async () => {
    const profile = await store.getDefaultProfile();
    expect(profile).toMatchObject({ name: 'Agent', isDefault: true, isActive: true });
    expect(profile!.toolkits).toContain('memory');
    const updated = await store.updateProfile(profile!.id, {
      model: 'openai/gpt-4.1',
      temperature: 0.2,
    });
    expect(updated).toMatchObject({ model: 'openai/gpt-4.1', temperature: 0.2, name: 'Agent' });
  });

  it('creates, finds, updates and forgets memories', async () => {
    const a = await store.createMemory({
      title: 'Prefers metric units',
      content: 'Always answer with kg and km',
      kind: 'preference',
      pinned: true,
      importance: 4,
      tags: ['units'],
    });
    expect(a).toMatchObject({ isActive: true, scope: 'global', pinned: true, importance: 4 });
    expect(a.createdAt).toBeTruthy();
    await store.createMemory({ title: 'Office is in Sydney', kind: 'fact' });

    expect((await store.listMemories({ pinned: true })).map((m) => m.title)).toEqual([
      'Prefers metric units',
    ]);
    expect((await store.listMemories({ text: 'kg and' })).map((m) => m.id)).toEqual([a.id]);
    expect(await store.listMemories()).toHaveLength(2);

    await store.updateMemory(a.id, { isActive: false });
    expect((await store.listMemories()).map((m) => m.title)).toEqual(['Office is in Sydney']);
    expect(await store.listMemories({ activeOnly: false })).toHaveLength(2);
  });

  it('keeps threads per owner and messages in order', async () => {
    const thread = await store.createThread({ title: 'First chat', ownerId: adminId() });
    expect(thread).toMatchObject({ ownerId: adminId(), status: 'active', messageCount: 0 });
    await store.createThread({ title: 'Someone else', ownerId: 'usrTestUserId_1' });

    const one = await store.appendMessages(thread.id, [
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi! How can I help?', model: 'openai/gpt-4.1' },
    ]);
    expect(one.map((m) => [m.seq, m.role, m.summary])).toEqual([
      [1, 'user', 'Hello there'],
      [2, 'assistant', 'Hi! How can I help?'],
    ]);
    const huge = 'x'.repeat(MAX_PARTS_BYTES + 1);
    const [third] = await store.appendMessages(thread.id, [
      { role: 'assistant', content: 'big', parts: huge },
    ]);
    expect(third.seq).toBe(3);
    expect(third.parts).toContain('parts omitted');

    expect((await store.listMessages(thread.id)).map((m) => m.seq)).toEqual([1, 2, 3]);
    expect((await store.listMessages(thread.id, { last: 2 })).map((m) => m.seq)).toEqual([2, 3]);

    const after = await store.getThread(thread.id);
    expect(after.messageCount).toBe(3);
    expect(after.lastMessageAt).toBeTruthy();

    const mine = await store.listThreads({ ownerId: adminId() });
    expect(mine.map((t) => t.title)).toEqual(['First chat']);

    await store.updateThread(thread.id, { status: 'archived', summary: 'greetings' });
    expect(await store.listThreads({ ownerId: adminId(), status: 'active' })).toHaveLength(0);

    await store.deleteThread(thread.id);
    expect(await store.listThreads({ ownerId: adminId() })).toHaveLength(0);
    expect(await store.listMessages(thread.id)).toHaveLength(0);
  });

  it('lists built-in skills and adds new ones', async () => {
    const skills = await store.listSkills();
    expect(skills).toHaveLength(BUILTIN_SKILLS.length);
    const search = await store.getSkillByName('knowledge-search');
    expect(search).toMatchObject({ source: 'builtin', isActive: true });

    const made = await store.createSkill({
      name: 'weekly-report',
      description: 'Use when asked for the weekly report',
      body: '1. Read the tasks table',
    });
    expect(made).toMatchObject({ source: 'agent', version: 1, invocation: 'auto' });
    await store.updateSkill(made.id, { isActive: false });
    expect(await store.listSkills()).toHaveLength(BUILTIN_SKILLS.length);
    expect(await store.listSkills({ activeOnly: false })).toHaveLength(BUILTIN_SKILLS.length + 1);
  });

  it('links credentials to skills', async () => {
    const tableId = home.tableMap.agent_credentials;
    const fields = home.fieldMap.agent_credentials;
    await asAgent(() =>
      app.get(RecordOpenApiService).createRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            fields: {
              [fields.name]: 'github',
              [fields.auth_kind]: 'bearer',
              [fields.allowed_hosts]: 'api.github.com\nuploads.github.com',
            },
          },
        ],
      })
    );
    const github = await store.getCredentialByName('github');
    expect(github).toMatchObject({
      authKind: 'bearer',
      allowedHosts: ['api.github.com', 'uploads.github.com'],
    });

    const skill = await store.getSkillByName('using-credentials');
    await store.updateSkill(skill!.id, { credentialIds: [github!.id] });
    expect((await store.getCredentialByName('github'))!.skillIds).toEqual([skill!.id]);

    const updated = await store.updateCredential(github!.id, {
      status: 'set',
      preview: 'ghp…a1b2',
    });
    expect(updated).toMatchObject({ status: 'set', preview: 'ghp…a1b2' });
    expect(await store.listCredentials()).toHaveLength(1);
  });

  it('still works after an admin renames columns and a table', async () => {
    const memoryTable = home.tableMap.agent_memory;
    const fieldApi = app.get(FieldOpenApiService);
    await asAgent(async () => {
      await fieldApi.updateField(memoryTable, home.fieldMap.agent_memory.title, { name: 'Gist' });
      await fieldApi.updateField(memoryTable, home.fieldMap.agent_memory.is_active, {
        name: 'Still true?',
      });
      await prisma.tableMeta.update({ where: { id: memoryTable }, data: { name: 'Memories' } });
    });

    const memory = await store.createMemory({ title: 'Renames do not matter' });
    const found = await store.listMemories({ text: 'Renames' });
    expect(found.map((m) => m.id)).toEqual([memory.id]);
    expect(found[0].title).toBe('Renames do not matter');
  });
});
