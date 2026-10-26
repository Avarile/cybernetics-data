/* eslint-disable sonarjs/no-duplicate-string */
/**
 * Knowledge ingest and derived sync (design §11.3, §11.5): queued ingest that comes back ready,
 * unchanged content skipped, atomic replace, the first embedding space built and activated, URL
 * ingest through the outbound guard, and knowledge-table and agent_memory records kept in sync.
 * Uses the disposable agent_rag_test database.
 */
import { readFileSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { FieldKeyType, FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { MockEmbeddingModelV3 } from 'ai/test';
import knex from 'knex';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { KnowledgeIngest } from '../src/features/agent/application/knowledge/knowledge-ingest';
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
import {
  createRecords,
  createTable,
  deleteRecord,
  initApp,
  permanentDeleteTable,
  runWithTestUser,
  updateRecord,
} from './utils/init-app';

const ragTestUrl = () => {
  const env = readFileSync(path.join(__dirname, '../../nextjs-app/.env.test'), 'utf8');
  const prisma = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1];
  const url = prisma.replace(/\/[^/?]+(?:\?.*)?$/, '/agent_rag_test');
  if (!url.includes('@127.0.0.1:5432/'))
    throw new Error('agent_rag_test must be the local disposable DB');
  return url;
};

/** Bag of words hashed into 16 dimensions: texts sharing words point the same way. */
const fakeVector = (text: string) => {
  const v = new Array(16).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 16;
    v[h] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  let value = await fn();
  while (!ok(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    value = await fn();
  }
  return value;
};

describe('Agent knowledge ingest and sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  let store: IAgentStorePort;
  let ingest: KnowledgeIngest;
  let server: Server;
  let pageUrl: string;
  const embedded: string[] = [];
  const baseId = () => globalThis.testConfig.baseId;
  const adminId = () => globalThis.testConfig.userId;
  const doc = (collection: string, ref: string) => rag.getDocument(documentIdFor(collection, ref));

  beforeAll(async () => {
    const url = ragTestUrl();
    const admin = knex({ client: 'pg', connection: url });
    await admin.raw('DROP SCHEMA IF EXISTS agent_rag CASCADE');
    await admin.destroy();
    process.env.AGENT_RAG_DATABASE_URL = url;
    process.env.AGENT_HTTP_ALLOWED_HOSTS = '127.0.0.1';
    process.env.AGENT_HTTP_ALLOW_PRIVATE_NETWORKS = 'true';

    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<html><head><title>Expense policy</title></head><body><h1>Travel</h1>' +
          '<p>Hotel costs are refunded with the monthly payroll.</p></body></html>'
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/policy`;

    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);
    store = app.get<IAgentStorePort>(AGENT_STORE_PORT);
    ingest = app.get(KnowledgeIngest);
    const profile = await store.getDefaultProfile();
    await store.updateProfile(profile!.id, { embeddingModel: 'mock/emb' });

    const model = new MockEmbeddingModelV3({
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => {
        embedded.push(...values);
        return { embeddings: values.map(fakeVector), warnings: [] };
      },
    });
    vi.spyOn(app.get<IModelPort>(MODEL_PORT), 'embedder').mockImplementation(async (ref) => ({
      ref,
      modelKey: `openai@${ref}@mock`,
      model,
    }));
    app.get(KnowledgeSyncListener).invalidate();
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('ingests text within the wait, builds and activates the first embedding space', async () => {
    const text =
      '# Handbook\n\n## Leave\n\nAnnual leave is 25 days.\n\n## Expenses\n\nTravel is refunded.';
    const result = await ingest.request({
      collectionId: 'knowledge',
      source: { kind: 'text', text, slug: 'handbook' },
      title: 'Staff handbook',
      actorUserId: adminId(),
    });
    expect(result).toMatchObject({ status: 'ready', chunkCount: 2, error: null });
    expect(embedded).toContain('Staff handbook › Handbook › Leave\n\nAnnual leave is 25 days.');

    const spaces = await until(
      () => rag.listSpaces(),
      (s) => s[0]?.status === 'active'
    );
    expect(spaces).toEqual([expect.objectContaining({ model: 'mock/emb', status: 'active' })]);
    expect(await rag.hasAllEmbeddings(result.documentId, spaces[0].slug)).toBe(true);

    const hits = await rag.query({
      text: 'leave',
      collections: ['knowledge'],
      vector: fakeVector('annual leave days'),
      space: spaces[0].slug,
    });
    expect(hits[0]).toMatchObject({ headingPath: 'Handbook › Leave', title: 'Staff handbook' });
  });

  it('skips unchanged content without embedding, and replaces changed content', async () => {
    const text =
      '# Handbook\n\n## Leave\n\nAnnual leave is 25 days.\n\n## Expenses\n\nTravel is refunded.';
    const before = embedded.length;
    const same = await ingest.request({
      collectionId: 'knowledge',
      source: { kind: 'text', text, slug: 'handbook' },
      actorUserId: adminId(),
    });
    expect(same).toMatchObject({ status: 'ready', chunkCount: 2 });
    expect(embedded.length).toBe(before);

    const changed = await ingest.request({
      collectionId: 'knowledge',
      source: { kind: 'text', text: 'Annual leave is now 28 days.', slug: 'handbook' },
      actorUserId: adminId(),
    });
    expect(changed).toMatchObject({ documentId: same.documentId, status: 'ready', chunkCount: 1 });
    const read = await rag.readDocument(same.documentId);
    expect(read?.title).toBe('Staff handbook');
    expect(read?.sections.map((s) => s.content)).toEqual(['Annual leave is now 28 days.']);
  });

  it('ingests a web page through the outbound guard', async () => {
    const result = await ingest.request({
      collectionId: 'knowledge',
      source: { kind: 'url', url: pageUrl },
      actorUserId: adminId(),
    });
    expect(result.status).toBe('ready');
    const read = await rag.readDocument(result.documentId);
    expect(read?.title).toBe('Expense policy');
    expect(read?.sections[0].content).toContain('Hotel costs are refunded');
    expect(read?.sections[0].content).not.toContain('<');
  });

  it('refuses documents in derived collections and unknown collections', async () => {
    await expect(
      ingest.request({
        collectionId: 'kb_records',
        source: { kind: 'text', text: 'x' },
        actorUserId: adminId(),
      })
    ).rejects.toThrow(/kept in sync/);
    await expect(
      ingest.request({
        collectionId: 'nope',
        source: { kind: 'text', text: 'x' },
        actorUserId: adminId(),
      })
    ).rejects.toThrow(/No collection nope/);
  });

  it('keeps knowledge-table records in sync, and ignores other tables', async () => {
    const kb = await createTable(baseId(), {
      name: 'Knowledges',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
        { name: 'Owner', type: FieldType.SingleLineText },
      ],
    });
    const plain = await createTable(baseId(), {
      name: 'Plain notes',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Notes', type: FieldType.LongText },
      ],
    });
    try {
      const fieldId = (name: string) => kb.fields.find((f) => f.name === name)!.id;
      const { records } = await createRecords(kb.id, {
        records: [
          {
            fields: {
              [fieldId('Title')]: 'VPN setup',
              [fieldId('context')]: 'Install the client.',
            },
          },
        ],
      });
      const recId = records[0].id;
      const ref = `record:${baseId()}/${kb.id}/${recId}`;
      const synced = await until(
        () => doc('kb_records', ref),
        (d) => d?.status === 'ready'
      );
      expect(synced).toMatchObject({ title: 'VPN setup', tableId: kb.id, recordId: recId });
      const hit = await rag.query({
        text: 'VPN',
        collections: ['kb_records'],
        baseIds: [baseId()],
      });
      expect(hit[0]).toMatchObject({ recordId: recId, section: 'Install the client.' });

      await updateRecord(kb.id, recId, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [fieldId('context')]: 'Install the client, then sign in.' } },
      });
      const updated = await until(
        () => rag.readDocument(synced!.id),
        (d) => d?.sections[0]?.content.includes('sign in') ?? false
      );
      expect(updated?.sections[0].content).toBe('Install the client, then sign in.');

      await createRecords(plain.id, {
        records: [{ fields: { [plain.fields[0].id]: 'Not knowledge' } }],
      });

      await deleteRecord(kb.id, recId);
      expect(
        await until(
          () => doc('kb_records', ref),
          (d) => !d
        )
      ).toBeUndefined();
      expect((await rag.listDocuments('kb_records')).map((d) => d.title)).not.toContain(
        'Not knowledge'
      );
    } finally {
      await permanentDeleteTable(baseId(), kb.id);
      await permanentDeleteTable(baseId(), plain.id);
    }
  });

  it('keeps agent memories in sync; forgetting one removes it', async () => {
    const memory = await store.createMemory({
      title: 'Quarter ends in March',
      content: 'The fiscal year ends on 31 March.',
    });
    const layout = await app.get(EnsureInstallation).layout();
    const ref = `record:${home.baseId}/${layout.tableMap.agent_memory}/${memory.id}`;
    const synced = await until(
      () => doc('agent_memory', ref),
      (d) => d?.status === 'ready'
    );
    expect(synced?.title).toBe('Quarter ends in March');

    await store.updateMemory(memory.id, { isActive: false });
    expect(
      await until(
        () => doc('agent_memory', ref),
        (d) => !d
      )
    ).toBeUndefined();
  });
});
