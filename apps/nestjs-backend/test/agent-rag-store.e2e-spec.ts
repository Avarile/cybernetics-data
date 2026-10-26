/* eslint-disable sonarjs/no-duplicate-string */
/**
 * PgRagStore against a real pgvector database (design §11.1, §11.4): schema, documents,
 * sectioned chunks, embedding spaces, hybrid query. Uses the disposable agent_rag_test database.
 */
import { readFileSync } from 'fs';
import path from 'path';
import knex from 'knex';
import type { IAgentConfig } from '../src/configs/agent.config';
import {
  documentIdFor,
  PgRagStore,
} from '../src/features/agent/infrastructure/knowledge/pg-rag-store';
import { spaceSlug } from '../src/features/agent/infrastructure/knowledge/rag-schema';

const testUrl = () => {
  const env = readFileSync(path.join(__dirname, '../../nextjs-app/.env.test'), 'utf8');
  const prisma = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1];
  const url = prisma.replace(/\/[^/?]+(?:\?.*)?$/, '/agent_rag_test');
  // never anything but the disposable container
  if (!url.includes('@127.0.0.1:5432/'))
    throw new Error('agent_rag_test must be the local disposable DB');
  return url;
};

describe('PgRagStore (pgvector)', () => {
  const url = testUrl();
  let store: PgRagStore;
  const unit = (x: number, y: number, z: number) => {
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n];
  };

  beforeAll(async () => {
    const admin = knex({ client: 'pg', connection: url });
    await admin.raw('DROP SCHEMA IF EXISTS agent_rag CASCADE');
    await admin.destroy();
    store = new PgRagStore({ ragDatabaseUrl: url } as IAgentConfig);
  });

  afterAll(async () => {
    await store.onModuleDestroy();
  });

  it('creates the schema once, idempotently, with the seeded collections', async () => {
    const again = new PgRagStore({ ragDatabaseUrl: url } as IAgentConfig);
    const [a, b] = await Promise.all([store.listCollections(), again.listCollections()]);
    await again.onModuleDestroy();
    expect(a.map((c) => [c.id, c.kind])).toEqual([
      ['agent_memory', 'derived'],
      ['kb_records', 'derived'],
      ['knowledge', 'documents'],
    ]);
    expect(b).toEqual(a);
  });

  it('derives document ids from collection and source, and upserts', async () => {
    const doc = await store.upsertDocument({
      collectionId: 'knowledge',
      sourceRef: 'text:handbook',
      title: 'Handbook',
      contentHash: 'h1',
      status: 'queued',
      baseId: null,
      tableId: null,
      recordId: null,
    });
    expect(doc.id).toBe(documentIdFor('knowledge', 'text:handbook'));
    const renamed = await store.upsertDocument({
      ...doc,
      title: 'Staff handbook',
      contentHash: 'h2',
    });
    expect(renamed).toMatchObject({ id: doc.id, title: 'Staff handbook', contentHash: 'h2' });
    expect((await store.listDocuments('knowledge')).length).toBe(1);
  });

  it('replaces chunks atomically with vectors, and searches by keyword, vector and both', async () => {
    const space = await store.ensureSpace('test/emb', 3, 'building');
    expect(space.slug).toBe(spaceSlug('test/emb', 3));
    await store.activateSpace(space.slug);
    const id = documentIdFor('knowledge', 'text:handbook');
    const count = await store.replaceChunks(
      id,
      [
        {
          headingPath: 'Leave',
          content: 'Annual leave is 25 days. Sick leave needs a note after 3 days.',
          chunks: ['Annual leave is 25 days.', 'Sick leave needs a note after 3 days.'],
        },
        {
          headingPath: 'Expenses',
          content: 'Travel expenses are paid monthly with the payroll run.',
          chunks: ['Travel expenses are paid monthly with the payroll run.'],
        },
      ],
      [{ space: space.slug, vectors: [unit(1, 0, 0), unit(0.9, 0.1, 0), unit(0, 0, 1)] }]
    );
    expect(count).toBe(3);
    expect(await store.getDocument(id)).toMatchObject({ status: 'ready', chunkCount: 3 });
    expect(await store.hasAllEmbeddings(id, space.slug)).toBe(true);

    const keyword = await store.query({
      text: 'payroll',
      collections: ['knowledge'],
      mode: 'keyword',
    });
    expect(keyword.map((h) => h.chunk)).toEqual([
      'Travel expenses are paid monthly with the payroll run.',
    ]);
    expect(keyword[0]).toMatchObject({ headingPath: 'Expenses', keywordRank: 1, vectorRank: null });

    const vector = await store.query({
      text: 'x',
      collections: ['knowledge'],
      vector: unit(1, 0.05, 0),
      space: space.slug,
      mode: 'vector',
    });
    expect(vector[0].chunk).toBe('Annual leave is 25 days.');

    // hybrid: the keyword hit and the vector hit both rank; the chunk found by both ranks first
    const hybrid = await store.query({
      text: 'leave',
      collections: ['knowledge'],
      vector: unit(0.95, 0.05, 0),
      space: space.slug,
    });
    expect(hybrid[0].vectorRank).not.toBeNull();
    expect(hybrid[0].keywordRank).not.toBeNull();
    expect(hybrid[0].section).toContain('Annual leave');
    expect(await store.query({ text: 'leave', collections: ['kb_records'] })).toEqual([]);
  });

  it('reads sections and documents', async () => {
    const id = documentIdFor('knowledge', 'text:handbook');
    const doc = await store.readDocument(id);
    expect(doc?.total).toBe(2);
    expect(doc?.sections.map((s) => s.headingPath)).toEqual(['Leave', 'Expenses']);
    const section = await store.readSection(doc!.sections[1].id);
    expect(section).toMatchObject({ headingPath: 'Expenses', title: 'Staff handbook' });
  });

  it('filters by base and table, and backfills a second space', async () => {
    const rec = await store.upsertDocument({
      collectionId: 'kb_records',
      sourceRef: 'record:bse1/tbl1/rec1',
      title: 'VPN setup',
      contentHash: 'r1',
      status: 'processing',
      baseId: 'bse1',
      tableId: 'tbl1',
      recordId: 'rec1',
    });
    await store.replaceChunks(
      rec.id,
      [{ headingPath: null, content: 'Use the VPN client', chunks: ['Use the VPN client'] }],
      []
    );
    const hit = await store.query({ text: 'VPN', collections: ['kb_records'], baseIds: ['bse1'] });
    expect(hit[0]).toMatchObject({ recordId: 'rec1', tableId: 'tbl1' });
    expect(
      await store.query({ text: 'VPN', collections: ['kb_records'], baseIds: ['bse2'] })
    ).toEqual([]);

    const next = await store.ensureSpace('test/emb2', 2, 'building');
    const missing = await store.chunksWithoutEmbedding(next.slug, 100);
    expect(missing.length).toBe(4);
    expect(missing.find((m) => m.text.includes('VPN'))?.text).toBe(
      'VPN setup\n\nUse the VPN client'
    );
    await store.writeEmbeddings(
      next.slug,
      missing.map((m) => ({ chunkId: m.id, vector: [1, 0] }))
    );
    expect(await store.chunksWithoutEmbedding(next.slug, 100)).toEqual([]);
    await store.activateSpace(next.slug);
    expect((await store.listSpaces()).map((s) => [s.slug, s.status])).toEqual([
      [spaceSlug('test/emb', 3), 'retired'],
      [next.slug, 'active'],
    ]);
  });

  it('deleting a document or a collection removes its chunks and vectors', async () => {
    const db = knex({ client: 'pg', connection: url });
    const id = documentIdFor('knowledge', 'text:handbook');
    await store.deleteDocument(id);
    const left = await db.raw(`select count(*)::int n from agent_rag.chunk where document_id = ?`, [
      id,
    ]);
    expect(left.rows[0].n).toBe(0);
    const vectors = await db.raw(
      `select count(*)::int n from agent_rag.embedding_${spaceSlug('test/emb', 3)}`
    );
    expect(vectors.rows[0].n).toBe(0);
    await store.createCollection({ id: 'tmp', label: 'Tmp', description: null, kind: 'documents' });
    await store.upsertDocument({
      collectionId: 'tmp',
      sourceRef: 'text:x',
      title: null,
      contentHash: 'x',
      status: 'queued',
      baseId: null,
      tableId: null,
      recordId: null,
    });
    await store.deleteCollection('tmp');
    expect(await store.listDocuments('tmp')).toEqual([]);
    await db.destroy();
  });
});
