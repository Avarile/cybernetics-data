/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Full sync of knowledge tables (design §11.3): records that existed before the agent was enabled
 * (or changed while the server was down) are indexed on the first knowledge search, documents of
 * vanished records are removed, and an embedding slot holding a chat model does not stop keyword
 * indexing. Uses the disposable agent_rag_test database.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { syncKnowledge } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { KnowledgeIngest } from '../src/features/agent/application/knowledge/knowledge-ingest';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RAG_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IRagStorePort,
} from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { KnowledgeSyncListener } from '../src/features/agent/infrastructure/knowledge/knowledge-sync.listener';
import { KnowledgeToolkit } from '../src/features/agent/toolkits/knowledge/knowledge.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import type { IClsStore } from '../src/types/cls';
import { freshRagTestDb } from './utils/agent-rag';
import { createTable, initApp, permanentDeleteTable, runWithTestUser } from './utils/init-app';

interface ISearchOut {
  mode: string;
  warnings: string[];
  results: { title: string | null; recordRef?: { recordId: string } }[];
}

describe('Agent knowledge full sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  let kbTableId: string;
  const adminId = () => globalThis.testConfig.userId;
  const baseId = () => globalThis.testConfig.baseId;
  const ctx = (): IToolContext => ({
    runId: 'e2e-sync',
    actorUserId: adminId(),
    profile: { rerankModel: null, approvalRequired: [] } as unknown as IAgentProfile,
  });
  const run = async <T>(name: string, input: unknown) => {
    const t = app.get(KnowledgeToolkit).tools.find((x) => x.name === name)!;
    return app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-sync', actorUserId: adminId() }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          ctx()
        )
      ) as Promise<T>;
  };

  beforeAll(async () => {
    process.env.AGENT_RAG_DATABASE_URL = await freshRagTestDb();
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);

    // the knowledge table and its records exist before the agent is enabled: no events reach it
    const kb = await createTable(baseId(), {
      name: 'knowledges',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
      ],
      records: [
        { fields: { title: 'K3S - Cheatsheet', context: 'kubectl get pods -A lists every pod.' } },
        { fields: { title: 'Tmux guide', context: 'Prefix then d detaches the session.' } },
      ],
    });
    kbTableId = kb.id;

    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    const store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    const profile = await store.getDefaultProfile();
    // a chat model in the embedding slot, as found on a real installation
    await store.updateProfile(profile!.id, { embeddingModel: 'gateway/minimax-chat' });
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'embedder').mockImplementation(async () => {
      throw new Error('Model minimax-chat does not support embeddings');
    });
    app.get(KnowledgeSyncListener).invalidate();
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId(), kbTableId);
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('the first knowledge search indexes existing records, by keyword when embedding fails', async () => {
    expect(await rag.listDocuments('kb_records')).toEqual([]);
    const out = await run<ISearchOut>('knowledge_search', { query: 'K3S cheatsheet' });
    expect(out.results[0]).toMatchObject({ title: 'K3S - Cheatsheet' });
    expect(out.mode).toBe('keyword');
    expect(out.warnings.join(' ')).toMatch(/cannot embed text/);
    expect((await rag.listDocuments('kb_records')).length).toBeGreaterThanOrEqual(2);
  });

  it('the admin sync is idempotent and removes documents of vanished records', async () => {
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
    expect(summary.unchanged).toBeGreaterThanOrEqual(2);
    expect((await rag.listDocuments('kb_records')).map((d) => d.title)).not.toContain('Gone');
  });

  it('a direct full sync reports per-record outcomes', async () => {
    const summary = await app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-sync', actorUserId: adminId() }, () =>
        app.get(KnowledgeIngest).syncAll(adminId())
      );
    expect(summary.tables).toBeGreaterThanOrEqual(1);
    expect(summary.errors).toEqual([]);
  });
});
