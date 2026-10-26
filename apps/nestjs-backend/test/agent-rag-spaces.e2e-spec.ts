/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Changing the embedding model (design §11.5): the new model's space is built in the background
 * while search keeps using the active one, new ingests write to both, the backfill activates the
 * new space and retires the old one, retired tables are dropped later, and choosing the old model
 * again revives its space. Uses the disposable agent_rag_test database.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { MockEmbeddingModelV3 } from 'ai/test';
import knex from 'knex';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EmbeddingSpaces } from '../src/features/agent/application/knowledge/embedding-spaces';
import { KnowledgeIngest } from '../src/features/agent/application/knowledge/knowledge-ingest';
import { KnowledgeSearch } from '../src/features/agent/application/knowledge/knowledge-search';
import {
  AGENT_STORE_PORT,
  MODEL_PORT,
  RAG_STORE_PORT,
  type IAgentStorePort,
  type IModelPort,
  type IRagStorePort,
} from '../src/features/agent/domain/ports';
import { KnowledgeSyncListener } from '../src/features/agent/infrastructure/knowledge/knowledge-sync.listener';
import { spaceSlug } from '../src/features/agent/infrastructure/knowledge/rag-schema';
import type { IClsStore } from '../src/types/cls';
import { fakeVector, freshRagTestDb, until } from './utils/agent-rag';
import { initApp, runWithTestUser } from './utils/init-app';

/** Model b: the first 8 dimensions of model a's vector, renormalised. */
const vectorB = (text: string) => {
  const v = fakeVector(text).slice(0, 8);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

describe('Agent embedding spaces (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  let store: IAgentStorePort;
  let url: string;
  let releaseBackfill: () => void = () => undefined;
  let held: Promise<void> = Promise.resolve();
  const calls: { model: string; values: string[] }[] = [];
  const adminId = () => globalThis.testConfig.userId;
  const spaceA = spaceSlug('mock/a', 16);
  const spaceB = spaceSlug('mock/b', 8);

  const model = (id: string, fn: (t: string) => number[]) =>
    new MockEmbeddingModelV3({
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => {
        calls.push({ model: id, values });
        // hold model b's backfill of the first document, so the build can be watched
        if (id === 'mock/b' && values.some((v) => v.includes('Annual leave'))) await held;
        return { embeddings: values.map(fn), warnings: [] };
      },
    });
  const setModel = async (ref: string) => {
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { embeddingModel: ref });
  };
  const spaces = async () =>
    Object.fromEntries((await rag.listSpaces()).map((s) => [s.slug, s.status]));
  const search = (query: string) =>
    app.get(KnowledgeSearch).search({ query, collections: ['knowledge'] });
  const ingest = (text: string, slug: string) =>
    app.get(KnowledgeIngest).request({
      collectionId: 'knowledge',
      source: { kind: 'text', text, slug },
      title: 'Handbook',
      actorUserId: adminId(),
    });

  beforeAll(async () => {
    url = await freshRagTestDb();
    process.env.AGENT_RAG_DATABASE_URL = url;
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    const models = new Map([
      ['mock/a', model('mock/a', fakeVector)],
      ['mock/b', model('mock/b', vectorB)],
    ]);
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'embedder').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model: models.get(ref)!,
    }));
    app.get(KnowledgeSyncListener).invalidate();
    await setModel('mock/a');
    await ingest('# Leave\n\nAnnual leave is 25 days.\n\n# Expenses\n\nTravel is refunded.', 'h1');
    expect(await until(spaces, (s) => s[spaceA] === 'active')).toEqual({ [spaceA]: 'active' });
  });

  afterAll(async () => {
    releaseBackfill();
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('builds the new model in the background while search keeps working', async () => {
    held = new Promise<void>((r) => (releaseBackfill = r));
    await setModel('mock/b');
    // the setup change alone starts the build (no ingest needed)
    expect(await until(spaces, (s) => s[spaceB] === 'building')).toEqual({
      [spaceA]: 'active',
      [spaceB]: 'building',
    });

    const during = await search('annual leave');
    expect(during.mode).toBe('hybrid');
    expect(during.results[0].headingPath).toBe('Leave');
    expect(calls.at(-1)).toEqual({ model: 'mock/a', values: ['annual leave'] });

    // a new document is written to both spaces
    const added = await ingest('Bike allowance is 30 euros a month.', 'bike');
    expect(added.status).toBe('ready');
    expect(await rag.hasAllEmbeddings(added.documentId, spaceA)).toBe(true);
    expect(await rag.hasAllEmbeddings(added.documentId, spaceB)).toBe(true);
  });

  it('activates the new space when the backfill is done and retires the old one', async () => {
    releaseBackfill();
    expect(await until(spaces, (s) => s[spaceB] === 'active')).toEqual({
      [spaceA]: 'retired',
      [spaceB]: 'active',
    });
    expect(await rag.chunksWithoutEmbedding(spaceB, 10)).toEqual([]);
    const retired = (await rag.listSpaces()).find((s) => s.slug === spaceA)!;
    expect(retired.retiredAt).not.toBeNull();

    const after = await search('travel refunded');
    expect(after.results[0].headingPath).toBe('Expenses');
    expect(calls.at(-1)).toEqual({ model: 'mock/b', values: ['travel refunded'] });
  });

  it('drops retired tables after the retention period, not before', async () => {
    const spacesSvc = app.get(EmbeddingSpaces);
    expect(await spacesSvc.cleanup()).toEqual([]);
    expect(await spacesSvc.cleanup(new Date(Date.now() + 8 * 86_400_000))).toEqual([spaceA]);
    const db = knex({ client: 'pg', connection: url });
    const exists = await db.raw(`select to_regclass(?) as t`, [`agent_rag.embedding_${spaceA}`]);
    await db.destroy();
    expect(exists.rows[0].t).toBeNull();
    expect(await spaces()).toEqual({ [spaceB]: 'active' });
  });

  it('choosing the old model again rebuilds its space from the stored text', async () => {
    await setModel('mock/a');
    expect(await until(spaces, (s) => s[spaceA] === 'active')).toEqual({
      [spaceA]: 'active',
      [spaceB]: 'retired',
    });
    expect(await rag.chunksWithoutEmbedding(spaceA, 10)).toEqual([]);
    const status = await app.get(EmbeddingSpaces).status();
    expect(status.configuredModel).toBe('mock/a');
  });
});
