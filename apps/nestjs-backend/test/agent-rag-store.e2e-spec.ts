/* eslint-disable sonarjs/no-duplicate-string */
/**
 * PgRagStore against the main PostgreSQL (design §11.1, §11.4): schema, documents, sectioned
 * chunks and full-text search (title weighting, prefixes, phrases, CJK, filters).
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import {
  documentIdFor,
  PgRagStore,
} from '../src/features/agent/infrastructure/knowledge/pg-rag-store';
import { freshRagSchema } from './utils/agent-rag';
import { initApp } from './utils/init-app';

describe('PgRagStore (full-text, main database)', () => {
  let app: INestApplication;
  let store: PgRagStore;
  const handbook = documentIdFor('knowledge', 'text:handbook');

  const addDoc = async (
    sourceRef: string,
    title: string,
    sections: { headingPath: string | null; content: string }[],
    collectionId = 'knowledge'
  ) => {
    const doc = await store.upsertDocument({
      collectionId,
      sourceRef,
      title,
      contentHash: 'h',
      status: 'processing',
      baseId: null,
      tableId: null,
      recordId: null,
    });
    await store.replaceChunks(
      doc.id,
      sections.map((s) => ({ ...s, chunks: [s.content] }))
    );
    return doc.id;
  };
  const titles = async (text: string) =>
    (await store.query({ text, collections: ['knowledge'] })).map((h) => h.title);

  beforeAll(async () => {
    await freshRagSchema();
    app = (await initApp()).app;
    store = new PgRagStore(app.get(PrismaService));
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates the schema once, idempotently, with the seeded collections', async () => {
    const again = new PgRagStore(app.get(PrismaService));
    const [a, b] = await Promise.all([store.listCollections(), again.listCollections()]);
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
    expect(doc.id).toBe(handbook);
    const renamed = await store.upsertDocument({
      ...doc,
      title: 'Staff handbook',
      contentHash: 'h2',
    });
    expect(renamed).toMatchObject({ id: handbook, title: 'Staff handbook', contentHash: 'h2' });
    expect((await store.listDocuments('knowledge')).length).toBe(1);
  });

  it('replaces chunks atomically and finds them by words, code and section', async () => {
    const count = await store.replaceChunks(handbook, [
      {
        headingPath: 'Leave',
        content: 'Annual leave is 25 days. Sick leave needs a note after 3 days.',
        chunks: ['Annual leave is 25 days.', 'Sick leave needs a note after 3 days.'],
      },
      {
        headingPath: 'Expenses',
        content: 'Travel expenses are paid monthly with the payroll run. Code INV-2041.',
        chunks: ['Travel expenses are paid monthly with the payroll run. Code INV-2041.'],
      },
    ]);
    expect(count).toBe(3);
    expect(await store.getDocument(handbook)).toMatchObject({ status: 'ready', chunkCount: 3 });

    const payroll = await store.query({ text: 'when is payroll?', collections: ['knowledge'] });
    expect(payroll[0]).toMatchObject({ headingPath: 'Expenses', title: 'Staff handbook' });
    expect(payroll[0].section).toContain('INV-2041');
    expect(
      (await store.query({ text: 'INV-2041', collections: ['knowledge'] }))[0].headingPath
    ).toBe('Expenses');
    // any one word is enough; the chunk with more of them ranks first
    const leave = await store.query({ text: 'sick leave note', collections: ['knowledge'] });
    expect(leave[0].chunk).toBe('Sick leave needs a note after 3 days.');
    expect(await store.query({ text: 'leave', collections: ['kb_records'] })).toEqual([]);
  });

  it('ranks titles above passing mentions, and matches word beginnings', async () => {
    await addDoc('text:k3s', 'K3S - Cheatsheet', [
      { headingPath: null, content: 'kubectl get pods -A lists every pod.' },
    ]);
    await addDoc('text:tmux', 'Tmux guide', [
      { headingPath: null, content: 'Unrelated to the K3S cheatsheet, prefix then d detaches.' },
    ]);
    expect((await titles('k3s cheatsheet'))[0]).toBe('K3S - Cheatsheet');
    expect(await titles('kubect')).toContain('K3S - Cheatsheet');
    expect(await titles('"prefix then d"')).toEqual(['Tmux guide']);
    expect(await titles('"prefix then d" -tmux')).toEqual([]);
  });

  it('finds Chinese text by any part of a phrase', async () => {
    await addDoc('text:holiday', '春节假期安排', [
      { headingPath: '值班', content: '假期期间每天安排一名工程师值班，值班表在假期前两周公布。' },
    ]);
    expect((await titles('春节值班怎么安排？'))[0]).toBe('春节假期安排');
    expect(await titles('工程师')).toContain('春节假期安排');
  });

  it('filters by base and table, and reads sections and documents', async () => {
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
    await store.replaceChunks(rec.id, [
      { headingPath: 'VPN setup', content: 'Use the client', chunks: ['Use the client'] },
    ]);
    // the title alone finds a record whose text does not mention it
    const hit = await store.query({ text: 'VPN', collections: ['kb_records'], baseIds: ['bse1'] });
    expect(hit[0]).toMatchObject({ recordId: 'rec1', tableId: 'tbl1' });
    expect(
      await store.query({ text: 'VPN', collections: ['kb_records'], baseIds: ['bse2'] })
    ).toEqual([]);

    const doc = await store.readDocument(handbook);
    expect(doc?.total).toBe(2);
    expect(doc?.sections.map((s) => s.headingPath)).toEqual(['Leave', 'Expenses']);
    const section = await store.readSection(doc!.sections[1].id);
    expect(section).toMatchObject({ headingPath: 'Expenses', title: 'Staff handbook' });
  });

  it('deleting a document or a collection removes its chunks', async () => {
    const prisma = app.get(PrismaService);
    await store.deleteDocument(handbook);
    const left = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int n from agent_rag.chunk where document_id = $1`,
      handbook
    );
    expect(left[0].n).toBe(0);
    await store.createCollection({ id: 'tmp', label: 'Tmp', description: null, kind: 'documents' });
    await addDoc('text:x', 'X', [{ headingPath: null, content: 'temporary words' }], 'tmp');
    await store.deleteCollection('tmp');
    expect(await store.listDocuments('tmp')).toEqual([]);
  });
});
