/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention */
/**
 * The one-off import of the old Mastra vectors (design §14.3), against a disposable copy of
 * Mastra's layout (index_schema.embedding_index, vector_schema.<index>) in agent_rag_test.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { importLegacyKnowledge } from '@teable/openapi';
import knex, { type Knex } from 'knex';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RAG_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IRagStorePort,
} from '../src/features/agent/domain/ports';
import { KnowledgeSyncListener } from '../src/features/agent/infrastructure/knowledge/knowledge-sync.listener';
import { documentIdFor } from '../src/features/agent/infrastructure/knowledge/pg-rag-store';
import type { IClsStore } from '../src/types/cls';
import { fakeEmbeddingModel, freshRagTestDb, until } from './utils/agent-rag';
import { initApp, runWithTestUser } from './utils/init-app';

const report = Array.from(
  { length: 150 },
  (_, i) => `Paragraph ${i} of the Q3 report says revenue grew in EMEA.`
).join(' ');

async function seedMastra(db: Knex) {
  await db.raw('DROP SCHEMA IF EXISTS index_schema CASCADE');
  await db.raw('DROP SCHEMA IF EXISTS vector_schema CASCADE');
  await db.raw('CREATE SCHEMA index_schema');
  await db.raw('CREATE SCHEMA vector_schema');
  await db.raw(`CREATE TABLE index_schema.embedding_index (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, label TEXT NOT NULL, description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true)`);
  await db('index_schema.embedding_index').insert([
    { name: 'knowledge', label: 'Knowledge Base', description: 'General documents' },
    { name: 'work', label: 'Work', description: 'Work documents' },
    { name: 'family', label: 'Family', description: 'Family documents' },
    { name: 'credential', label: 'Credentials', description: 'Licenses and keys' },
  ]);
  const table = async (name: string, rows: Record<string, unknown>[]) => {
    await db.raw(`CREATE TABLE vector_schema.${name} (
      id SERIAL PRIMARY KEY, vector_id TEXT UNIQUE NOT NULL, embedding vector(3),
      metadata JSONB DEFAULT '{}'::jsonb)`);
    await db
      .withSchema('vector_schema')
      .from(name)
      .insert(
        rows.map((metadata, i) => ({
          vector_id: `${metadata.materialId}_${metadata.chunkIndex ?? i}`,
          embedding: '[1,0,0]',
          metadata,
        }))
      );
  };
  // chunk 1 before chunk 0, to check the ordering
  await table('knowledge', [
    { materialId: 'mQ3', docName: 'Q3 Report', chunkIndex: 1, content: report.slice(3600, 8000) },
    { materialId: 'mQ3', docName: 'Q3 Report', chunkIndex: 0, content: report.slice(0, 4000) },
    { materialId: 'mQ3', docName: 'Q3 Report', chunkIndex: 2, content: report.slice(7600) },
    {
      materialId: 'mVpn',
      docName: 'VPN guide',
      chunkIndex: 0,
      content: 'Install WireGuard first.',
    },
  ]);
  await table('work', [
    { materialId: 'mFal', docName: 'Falcon plan', chunkIndex: 0, content: 'Falcon ships in May.' },
  ]);
  await table('credential', [
    { materialId: 'mKey', docName: 'API key', chunkIndex: 0, content: 'sk-not-a-real-key' },
  ]);
  await table('dd_worksheet', [
    { materialId: 'mDd', docName: 'DD sheet', chunkIndex: 0, item: 'Check the cap table.' },
  ]);
}

describe('Agent legacy knowledge import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  let source: Knex;
  const adminId = () => globalThis.testConfig.userId;

  beforeAll(async () => {
    const url = await freshRagTestDb();
    process.env.AGENT_RAG_DATABASE_URL = url;
    process.env.VECTOR_DATABASE_URL = url;
    source = knex({ client: 'pg', connection: url });
    await seedMastra(source);

    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);
    const store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { embeddingModel: 'mock/emb' });
    const model = fakeEmbeddingModel();
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'embedder').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model,
    }));
    app.get(KnowledgeSyncListener).invalidate();
  });

  afterAll(async () => {
    await source.raw('DROP SCHEMA IF EXISTS index_schema CASCADE');
    await source.raw('DROP SCHEMA IF EXISTS vector_schema CASCADE');
    await source.destroy();
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('reports what a dry run would import, and writes nothing', async () => {
    const dry = await importLegacyKnowledge({ dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, found: true, queued: 0 });
    const byIndex = Object.fromEntries(dry.indexes.map((i) => [i.index, i]));
    expect(byIndex.knowledge).toMatchObject({ outcome: 'would_import', documents: 2, chunks: 4 });
    expect(byIndex.work).toMatchObject({ outcome: 'would_import', documents: 1 });
    expect(byIndex.family).toMatchObject({ outcome: 'empty', documents: 0 });
    expect(byIndex.credential).toMatchObject({ outcome: 'skipped_secret', collection: null });
    expect(byIndex.dd_worksheet).toMatchObject({
      outcome: 'would_import',
      note: 'vector table without a registry row',
    });
    expect((await rag.listCollections()).map((c) => c.id)).not.toContain('work');
  });

  it('imports each index into a collection, rebuilding documents from their chunks', async () => {
    const result = await importLegacyKnowledge({});
    expect(result.queued).toBe(4);
    const ids = (await rag.listCollections()).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['knowledge', 'work', 'family', 'dd_worksheet']));
    expect(ids).not.toContain('credential');

    const q3 = documentIdFor('knowledge', 'legacy:knowledge/Q3 Report');
    const ready = await until(
      () => rag.getDocument(q3),
      (d) => d?.status === 'ready'
    );
    expect(ready).toMatchObject({ title: 'Q3 Report', sourceRef: 'legacy:knowledge/Q3 Report' });
    const doc = await rag.readDocument(q3, { from: 1, to: 50 });
    expect(
      doc!.sections
        .map((s) => s.content)
        .join('\n\n')
        .replace(/\s+/g, ' ')
    ).toBe(report);

    const sheet = await until(
      () => rag.getDocument(documentIdFor('dd_worksheet', 'legacy:dd_worksheet/DD sheet')),
      (d) => d?.status === 'ready'
    );
    expect(sheet?.chunkCount).toBe(1);
    expect(await rag.listDocuments('family')).toEqual([]);
    // the Mastra schemas are left for the admin to drop after checking
    const left = await source.raw(`select to_regclass('vector_schema.knowledge') as t`);
    expect(left.rows[0].t).not.toBeNull();
  });

  it('running it again changes nothing', async () => {
    const before = await rag.getDocument(documentIdFor('work', 'legacy:work/Falcon plan'));
    await importLegacyKnowledge({});
    const after = await until(
      () => rag.getDocument(documentIdFor('work', 'legacy:work/Falcon plan')),
      (d) => d?.status === 'ready'
    );
    expect(after).toMatchObject({ contentHash: before!.contentHash, chunkCount: 1 });
    expect((await rag.listDocuments('knowledge')).length).toBe(2);
  });
});
