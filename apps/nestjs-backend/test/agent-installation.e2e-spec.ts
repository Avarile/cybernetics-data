/* eslint-disable sonarjs/no-duplicate-string */
/**
 * The agent's home (design §7.1, §7.4): enabling creates the Agent space, base and tables; every
 * check repairs what is missing without touching what an admin changed, and keeps the space's
 * members exactly the instance admins.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { AGENT_TABLES } from '../src/features/agent/pack/agent-pack';
import { BUILTIN_SKILLS } from '../src/features/agent/pack/builtin-skills';
import { FieldOpenApiService } from '../src/features/field/open-api/field-open-api.service';
import { RecordOpenApiService } from '../src/features/record/open-api/record-open-api.service';
import { RecordService } from '../src/features/record/record.service';
import { TableOpenApiService } from '../src/features/table/open-api/table-open-api.service';
import type { IClsStore } from '../src/types/cls';
import { initApp, runWithTestUser } from './utils/init-app';

describe('Agent installation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cls: ClsService<IClsStore>;
  let ensure: EnsureInstallation;
  let execution: AgentExecutionContext;
  const adminId = () => globalThis.testConfig.userId;

  const asAgent = <T>(fn: () => Promise<T>) =>
    execution.run({ runId: 'e2e', actorUserId: adminId() }, fn);
  const records = (tableId: string) =>
    asAgent(() =>
      app.get(RecordService).getRecords(tableId, { fieldKeyType: 'id' as never, take: 100 })
    );

  beforeAll(async () => {
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    cls = app.get(ClsService);
    ensure = app.get(EnsureInstallation);
    execution = app.get(AgentExecutionContext);
    await prisma.agentInstallation.deleteMany({});
  });

  afterAll(async () => {
    const row = await prisma.agentInstallation.findFirst();
    if (row?.spaceId) {
      await prisma.space.update({ where: { id: row.spaceId }, data: { deletedTime: new Date() } });
    }
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('enable creates the Agent space, base, six tables and the seeds', async () => {
    const view = await runWithTestUser(cls, () => ensure.enable(adminId()), { isAdmin: true });
    expect(view.status).toBe('ok');
    expect(Object.keys(view.tableMap).sort()).toEqual(Object.values(AGENT_TABLES).sort());

    const tables = await prisma.tableMeta.findMany({
      where: { baseId: view.baseId!, deletedTime: null },
    });
    expect(tables).toHaveLength(6);

    const setup = await records(view.tableMap.agent_setup);
    expect(setup.records).toHaveLength(1);
    const skills = await records(view.tableMap.agent_skills);
    expect(skills.records).toHaveLength(BUILTIN_SKILLS.length);

    const owners = await prisma.collaborator.findMany({ where: { resourceId: view.spaceId! } });
    expect(owners.map((o) => [o.principalId, o.roleName])).toEqual([[adminId(), 'owner']]);
  });

  it('a second check changes nothing', async () => {
    const before = await ensure.status();
    const view = await ensure.ensure('e2e');
    expect(view.health).toMatchObject({
      repaired: { tables: [], fields: [] },
      membership: { added: [], removed: [] },
    });
    expect(view.tableMap).toEqual(before.tableMap);
    expect(view.fieldMap).toEqual(before.fieldMap);
    const skills = await records(view.tableMap.agent_skills);
    expect(skills.records).toHaveLength(BUILTIN_SKILLS.length);
  });

  it('recreates a deleted field and keeps a renamed one', async () => {
    const before = await ensure.status();
    const memory = before.tableMap.agent_memory;
    const pinned = before.fieldMap.agent_memory.pinned;
    const content = before.fieldMap.agent_memory.content;
    await asAgent(async () => {
      await app.get(FieldOpenApiService).deleteField(memory, pinned);
      await app.get(FieldOpenApiService).updateField(memory, content, { name: 'Details' });
    });

    const view = await ensure.ensure('e2e');
    expect(view.status).toBe('ok');
    expect(view.health).toMatchObject({ repaired: { fields: ['agent_memory.pinned'] } });
    expect(view.health?.renamed).toEqual(['agent_memory.content']);
    expect(view.fieldMap.agent_memory.pinned).not.toBe(pinned);
    expect(view.fieldMap.agent_memory.content).toBe(content);
    const fields = await prisma.field.findMany({ where: { tableId: memory, deletedTime: null } });
    expect(fields.map((f) => f.name)).toEqual(expect.arrayContaining(['pinned', 'Details']));
    expect(fields.map((f) => f.name)).not.toContain('content');
  });

  it('recreates a deleted table', async () => {
    const before = await ensure.status();
    await asAgent(() =>
      app.get(TableOpenApiService).deleteTable(before.baseId!, before.tableMap.agent_credentials)
    );
    const view = await ensure.ensure('e2e');
    expect(view.status).toBe('ok');
    expect(view.health).toMatchObject({
      repaired: { tables: ['agent_credentials'], fields: ['agent_skills.credentials'] },
    });
    expect(view.tableMap.agent_credentials).not.toBe(before.tableMap.agent_credentials);
    // deleting the table turned the skills-side link into text; it is kept, renamed, and the
    // link is rebuilt under the pack name
    const skillFields = await prisma.field.findMany({
      where: { tableId: view.tableMap.agent_skills, deletedTime: null },
    });
    const byName = new Map(skillFields.map((f) => [f.name, f.type]));
    expect(byName.get('credentials')).toBe('link');
    expect(byName.get('credentials (detached)')).toBe('singleLineText');
  });

  it('never overwrites a built-in skill an admin edited', async () => {
    const before = await ensure.status();
    const skillsTable = before.tableMap.agent_skills;
    const body = before.fieldMap.agent_skills.body;
    const [first] = (await records(skillsTable)).records;
    await asAgent(() =>
      app.get(RecordOpenApiService).updateRecord(skillsTable, first.id, {
        fieldKeyType: 'id' as never,
        record: { fields: { [body]: 'my own instructions' } },
      })
    );
    // force the seeding step to run again
    await prisma.agentInstallation.update({ where: { id: 'agent' }, data: { seededVersion: 0 } });
    await ensure.ensure('e2e');

    const after = await records(skillsTable);
    expect(after.records).toHaveLength(BUILTIN_SKILLS.length);
    expect(after.records.find((r) => r.id === first.id)!.fields[body]).toBe('my own instructions');
  });

  describe('built-in skill upgrades', () => {
    const skillsByName = async () => {
      const { tableMap, fieldMap } = await ensure.status();
      const fm = fieldMap.agent_skills;
      const rows = (await records(tableMap.agent_skills)).records;
      return {
        table: tableMap.agent_skills,
        fm,
        byName: new Map(rows.map((r) => [r.fields[fm.name] as string, r])),
      };
    };
    const reseed = async () => {
      await prisma.agentInstallation.update({ where: { id: 'agent' }, data: { seededVersion: 0 } });
      await ensure.ensure('e2e');
    };

    it('renames an unedited built-in in place and removes the copies earlier seeds added', async () => {
      const { table, fm, byName } = await skillsByName();
      const documents = byName.get('document-search')!;
      const recordsApi = app.get(RecordOpenApiService);
      // what an install seeded before the rename holds: the old name and version, plus a -v2 copy
      await asAgent(async () => {
        await recordsApi.updateRecord(table, documents.id, {
          fieldKeyType: 'id' as never,
          record: { fields: { [fm.name]: 'rag-search', [fm.version]: 1 } },
        });
        await recordsApi.createRecords(table, {
          fieldKeyType: 'id' as never,
          typecast: true,
          records: [
            {
              fields: {
                [fm.name]: 'rag-search-v2',
                [fm.body]: documents.fields[fm.body],
                [fm.source]: 'builtin',
                [fm.version]: 2,
              },
            },
          ],
        });
      });
      await reseed();

      const after = (await skillsByName()).byName;
      expect(after.get('document-search')?.id).toBe(documents.id);
      expect(after.get('document-search')?.fields[fm.version]).toBe(2);
      expect(after.has('rag-search')).toBe(false);
      expect(after.has('rag-search-v2')).toBe(false);
    });

    it('offers a newer version of an edited built-in as an inactive copy', async () => {
      const { table, fm, byName } = await skillsByName();
      const knowledge = byName.get('knowledge-search')!;
      await asAgent(() =>
        app.get(RecordOpenApiService).updateRecord(table, knowledge.id, {
          fieldKeyType: 'id' as never,
          record: { fields: { [fm.body]: 'my own search steps', [fm.version]: 1 } },
        })
      );
      await reseed();

      const after = (await skillsByName()).byName;
      expect(after.get('knowledge-search')?.fields[fm.body]).toBe('my own search steps');
      const offered = after.get('knowledge-search-v2');
      expect(offered).toBeDefined();
      expect(offered!.fields[fm.is_active]).toBeFalsy();
    });
  });

  it('removes anyone who is not an instance admin', async () => {
    const view = await ensure.status();
    const outsider = await prisma.user.findFirstOrThrow({
      where: { isAdmin: { not: true }, isSystem: null, email: { endsWith: '@e2e.com' } },
    });
    await prisma.collaborator.create({
      data: {
        resourceType: 'space',
        resourceId: view.spaceId!,
        principalId: outsider.id,
        principalType: 'user',
        roleName: 'editor',
        createdBy: adminId(),
      },
    });
    const checked = await ensure.ensure('e2e');
    expect(checked.health).toMatchObject({ membership: { removed: [`user:${outsider.id}`] } });
    const members = await prisma.collaborator.findMany({ where: { resourceId: view.spaceId! } });
    expect(members.map((m) => m.principalId)).toEqual([adminId()]);
  });

  it('stops with needs_setup while the base is in the trash, and recovers on restore', async () => {
    const view = await ensure.status();
    await prisma.base.update({ where: { id: view.baseId! }, data: { deletedTime: new Date() } });
    const trashed = await ensure.ensure('e2e');
    expect(trashed.status).toBe('needs_setup');
    await expect(ensure.ensureFresh()).rejects.toThrow(/needs setup/);

    await prisma.base.update({ where: { id: view.baseId! }, data: { deletedTime: null } });
    expect((await ensure.ensure('e2e')).status).toBe('ok');
    await expect(ensure.ensureFresh()).resolves.toMatchObject({ status: 'ok' });
  });
});
