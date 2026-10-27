/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Search over every table (current-design §4): the full sync indexes knowledge tables into
 * kb_records and every other table into records; record events, field changes, table deletes and
 * the search settings keep the index in step. Uses the disposable e2e database.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { syncKnowledge, updateField } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import {
  AGENT_STORE_PORT,
  RAG_STORE_PORT,
  type IAgentStorePort,
  type IRagStorePort,
} from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { KnowledgeSyncListener } from '../src/features/agent/infrastructure/knowledge/knowledge-sync.listener';
import { KnowledgeToolkit } from '../src/features/agent/toolkits/knowledge/knowledge.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import type { IClsStore } from '../src/types/cls';
import { freshRagSchema, until } from './utils/agent-rag';
import {
  createRecords,
  createTable,
  deleteRecord,
  deleteTable,
  initApp,
  permanentDeleteTable,
  runWithTestUser,
  updateRecord,
} from './utils/init-app';

interface ISearchOut {
  warnings: string[];
  searched: string[];
  results: {
    title: string | null;
    collection: string;
    snippet: string;
    recordRef?: { tableId: string; recordId: string };
  }[];
}

describe('Agent search over every table (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  let store: IAgentStorePort;
  let kbTableId: string;
  let projectsTableId: string;
  let ownerFieldId: string;
  const adminId = () => globalThis.testConfig.userId;
  const baseId = () => globalThis.testConfig.baseId;
  const ctx = (): IToolContext => ({
    runId: 'e2e-sync',
    actorUserId: adminId(),
    profile: { approvalRequired: [] } as unknown as IAgentProfile,
  });
  const asAgent = <T>(fn: () => Promise<T>) =>
    app.get(AgentExecutionContext).run({ runId: 'e2e-sync', actorUserId: adminId() }, fn);
  const search = (input: Record<string, unknown>) => {
    const t = app.get(KnowledgeToolkit).tools.find((x) => x.name === 'search')!;
    return asAgent(() =>
      (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(t.input.parse(input), ctx())
    ) as Promise<ISearchOut>;
  };
  const projectDocs = () => rag.listTableDocuments(projectsTableId, ['kb_records', 'records']);
  const setSearch = async (patch: Partial<IAgentProfile>) => {
    const profile = await asAgent(() => store.getDefaultProfile());
    await asAgent(() => store.updateProfile(profile!.id, patch));
  };

  beforeAll(async () => {
    await freshRagSchema();
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);

    // both tables and their records exist before the agent is enabled: no events reach them
    const kb = await createTable(baseId(), {
      name: 'knowledges',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
      ],
      records: [
        { fields: { title: 'K3S - Cheatsheet', context: 'kubectl get pods -A lists every pod.' } },
        { fields: { title: 'Tmux guide', context: 'Prefix then d detaches the session.' } },
        // more than the AI data service's 120 calls a minute: the sync must not go through it
        ...Array.from({ length: 130 }, (_, i) => ({
          fields: { title: `Note ${i}`, context: `Filler note number ${i}.` },
        })),
      ],
    });
    kbTableId = kb.id;
    const projects = await createTable(baseId(), {
      name: 'Projects',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: { choices: [{ name: 'Active' }, { name: 'Paused' }] },
        },
        { name: 'Owner', type: FieldType.SingleLineText },
        { name: 'Budget', type: FieldType.Number },
      ],
      records: [
        { fields: { Name: 'Apollo rollout', Status: 'Active', Owner: 'Dana', Budget: 12000 } },
        { fields: { Name: 'Hermes billing', Status: 'Paused', Owner: 'Lee', Budget: 400 } },
      ],
    });
    projectsTableId = projects.id;
    ownerFieldId = projects.fields.find((f) => f.name === 'Owner')!.id;

    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    app.get(KnowledgeSyncListener).invalidate();
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId(), kbTableId);
    await permanentDeleteTable(baseId(), projectsTableId).catch(() => undefined);
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('says so before the first sync', async () => {
    const out = await search({ query: 'Apollo' });
    expect(out.warnings.join(' ')).toMatch(/still being indexed/);
  });

  it(
    'a full sync indexes knowledge tables into kb_records and every other table into records',
    {
      timeout: 60_000,
    },
    async () => {
      const summary = await syncKnowledge();
      expect(summary).toMatchObject({ failed: 0, errors: [] });
      expect(summary.tables).toBeGreaterThanOrEqual(2);
      expect((await rag.listDocuments('kb_records', 1000)).length).toBeGreaterThanOrEqual(132);

      const out = await search({ query: 'Apollo rollout' });
      expect(out.warnings).toEqual([]);
      expect(out.searched).toContain('records');
      expect(out.results[0]).toMatchObject({
        title: 'Apollo rollout',
        collection: 'records',
        recordRef: { tableId: projectsTableId },
        // names are looked up when searching, so renames show at once
        table: 'Projects',
      });
      expect(out.results[0].snippet).toContain('Status: Active');
      // field values are searchable too, not only titles
      expect((await search({ query: 'Dana' })).results[0]?.title).toBe('Apollo rollout');
      // knowledge search stays on the knowledge tables
      const kbOnly = await search({ query: 'Apollo', collections: ['kb_records'] });
      expect(kbOnly.results).toEqual([]);
    }
  );

  it('a second sync changes nothing and drops documents of vanished records', async () => {
    await rag.upsertDocument({
      collectionId: 'kb_records',
      sourceRef: `record:${baseId()}/${kbTableId}/recGone0000000000`,
      title: 'Gone',
      contentHash: 'x',
      status: 'ready',
      baseId: baseId(),
      tableId: kbTableId,
      recordId: 'recGone0000000000',
    });
    const summary = await syncKnowledge();
    expect(summary).toMatchObject({ failed: 0, indexed: 0, removed: 1 });
    expect(summary.unchanged).toBeGreaterThanOrEqual(134);
    expect((await rag.listDocuments('kb_records', 1000)).map((d) => d.title)).not.toContain('Gone');
  });

  it('record changes in any table reach search', { timeout: 30_000 }, async () => {
    const [created] = (
      await createRecords(projectsTableId, {
        fieldKeyType: 'name' as never,
        records: [{ fields: { Name: 'Zephyr audit', Owner: 'Kim', Status: 'Active' } }],
      })
    ).records;
    const found = await until(
      () => search({ query: 'Zephyr' }),
      (out) => out.results[0]?.title === 'Zephyr audit',
      15_000
    );
    expect(found.results[0].snippet).toContain('Owner: Kim');

    await updateRecord(projectsTableId, created.id, {
      record: { fields: { Owner: 'Robin' } },
      fieldKeyType: 'name' as never,
    });
    const updated = await until(
      () => search({ query: 'Zephyr' }),
      (out) => Boolean(out.results[0]?.snippet.includes('Owner: Robin')),
      15_000
    );
    expect(updated.results[0].snippet).toContain('Owner: Robin');

    await deleteRecord(projectsTableId, created.id);
    const gone = await until(
      () => search({ query: 'Zephyr' }),
      (out) => out.results.length === 0,
      15_000
    );
    expect(gone.results).toEqual([]);
  });

  it('renaming a field re-indexes its table', { timeout: 30_000 }, async () => {
    await updateField(projectsTableId, ownerFieldId, { name: 'Lead' });
    const renamed = await until(
      () => search({ query: 'Apollo rollout' }),
      (out) => Boolean(out.results[0]?.snippet.includes('Lead: Dana')),
      20_000
    );
    expect(renamed.results[0].snippet).toContain('Lead: Dana');
  });

  it(
    'excluded tables and the knowledge scope drop their documents',
    { timeout: 60_000 },
    async () => {
      // agent_setup changes reach the listener like any record change and queue a full sync
      await setSearch({ searchExclude: [projectsTableId] });
      expect(await until(projectDocs, (docs) => docs.length === 0, 20_000)).toEqual([]);

      await setSearch({ searchExclude: [] });
      expect((await until(projectDocs, (docs) => docs.length >= 2, 20_000)).length).toBe(2);

      await setSearch({ searchScope: 'knowledge' });
      expect(await until(projectDocs, (docs) => docs.length === 0, 20_000)).toEqual([]);
      expect((await rag.listDocuments('kb_records', 1000)).length).toBeGreaterThanOrEqual(132);

      await setSearch({ searchScope: 'all' });
      expect((await until(projectDocs, (docs) => docs.length >= 2, 20_000)).length).toBe(2);
    }
  );

  it("a deleted table's documents go", { timeout: 30_000 }, async () => {
    expect(await projectDocs()).toHaveLength(2);
    await deleteTable(baseId(), projectsTableId);
    expect(await until(projectDocs, (docs) => docs.length === 0, 15_000)).toEqual([]);
  });
});
