/* eslint-disable sonarjs/no-duplicate-string */
/**
 * The knowledge toolkit (design §8 knowledge, §11.4): hybrid search with snippets and section
 * grouping, exact-code hits, rag_read with ranges, base filters, collections and approvals.
 * Uses the disposable e2e database.
 */
import { FieldType } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IAgentInstallationView } from '../src/features/agent/application/installation/ensure-installation.usecase';
import { EnsureInstallation } from '../src/features/agent/application/installation/ensure-installation.usecase';
import type { IAgentProfile } from '../src/features/agent/domain/entities';
import { RAG_STORE_PORT, type IRagStorePort } from '../src/features/agent/domain/ports';
import { AgentExecutionContext } from '../src/features/agent/infrastructure/execution-context';
import { KnowledgeSyncListener } from '../src/features/agent/infrastructure/knowledge/knowledge-sync.listener';
import { KnowledgeToolkit } from '../src/features/agent/toolkits/knowledge/knowledge.toolkit';
import type { IToolContext } from '../src/features/agent/toolkits/toolkit.types';
import type { IClsStore } from '../src/types/cls';
import { freshRagSchema, until } from './utils/agent-rag';
import {
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
  runWithTestUser,
} from './utils/init-app';

interface ISearchOut {
  searched: string[];
  failed: { collection: string; error: string }[];
  results: {
    documentId: string;
    sectionId: number;
    title: string | null;
    headingPath: string | null;
    snippet: string;
    recordRef?: { recordId: string };
  }[];
}

const long = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${topic} detail number ${i} explained at length.`).join(' ');

describe('Agent knowledge toolkit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let home: IAgentInstallationView;
  let rag: IRagStorePort;
  const adminId = () => globalThis.testConfig.userId;
  const baseId = () => globalThis.testConfig.baseId;
  const ctx = (): IToolContext => ({
    runId: 'e2e-knowledge',
    actorUserId: adminId(),
    profile: { approvalRequired: [] } as unknown as IAgentProfile,
  });
  const tool = (name: string) => app.get(KnowledgeToolkit).tools.find((t) => t.name === name)!;
  const run = async <T = Record<string, unknown>>(name: string, input: unknown) => {
    const t = tool(name);
    return app
      .get(AgentExecutionContext)
      .run({ runId: 'e2e-knowledge', actorUserId: adminId() }, () =>
        (t.execute as (i: unknown, c: IToolContext) => Promise<unknown>)(
          t.input.parse(input),
          ctx()
        )
      ) as Promise<T>;
  };

  beforeAll(async () => {
    await freshRagSchema();
    app = (await initApp()).app;
    prisma = app.get(PrismaService);
    await prisma.agentInstallation.deleteMany({});
    const cls = app.get<ClsService<IClsStore>>(ClsService);
    home = await runWithTestUser(cls, () => app.get(EnsureInstallation).enable(adminId()), {
      isAdmin: true,
    });
    rag = app.get<IRagStorePort>(RAG_STORE_PORT);
    app.get(KnowledgeSyncListener).invalidate();

    const handbook = [
      '# Handbook',
      '## Leave',
      long('Leave', 40),
      'Annual leave is 25 days per year.',
      '## Invoices',
      'Invoice INV-2041 was paid late in March.',
    ].join('\n\n');
    const added = await run<{ status: string }>('rag_ingest', {
      collection: 'knowledge',
      text: handbook,
      slug: 'handbook',
      title: 'Staff handbook',
    });
    expect(added.status).toBe('ready');
  });

  afterAll(async () => {
    await prisma.space.update({ where: { id: home.spaceId! }, data: { deletedTime: new Date() } });
    await prisma.agentInstallation.deleteMany({});
    await app.close();
  });

  it('asks before ingesting and before deleting a collection', () => {
    expect(tool('rag_ingest').approval).toEqual({ category: 'knowledge_write' });
    expect(tool('collection_create').approval).toEqual({ category: 'knowledge_write' });
    expect(tool('collection_delete').approval).toEqual({
      category: 'knowledge_write',
      always: true,
    });
    expect(tool('search').untrusted).toBe(true);
    expect(tool('search').approval).toBeUndefined();
  });

  it('search returns one result per section, with snippets', async () => {
    const out = await run<ISearchOut>('search', { query: 'leave detail explained' });
    expect(out.searched).toEqual(['agent_memory', 'kb_records', 'knowledge']);
    const sections = out.results.map((r) => r.sectionId);
    expect(new Set(sections).size).toBe(sections.length);
    expect(out.results[0]).toMatchObject({
      title: 'Staff handbook',
      headingPath: 'Handbook › Leave',
    });
    expect(out.results[0].snippet.length).toBeLessThanOrEqual(400);
  });

  it('finds an exact code by keyword', async () => {
    const out = await run<ISearchOut>('search', {
      query: 'INV-2041',
      collections: ['knowledge'],
    });
    expect(out.results[0].headingPath).toBe('Handbook › Invoices');
    expect(out.results[0].snippet).toContain('INV-2041');
  });

  it('rag_read reads a section, and a document in ranges', async () => {
    const hit = (await run<ISearchOut>('search', { query: 'INV-2041' })).results[0];
    const section = await run<{ content: string; title: string }>('rag_read', {
      sectionId: hit.sectionId,
    });
    expect(section).toMatchObject({
      title: 'Staff handbook',
      content: expect.stringContaining('INV-2041'),
    });

    const first = await run<{
      sections: { headingPath: string }[];
      nextFrom: number | null;
      total: number;
    }>('rag_read', { documentId: hit.documentId, to: 1 });
    expect(first.total).toBe(2);
    expect(first.sections.map((s) => s.headingPath)).toEqual(['Handbook › Leave']);
    expect(first.nextFrom).toBe(2);
    const rest = await run<{ sections: { headingPath: string }[]; nextFrom: number | null }>(
      'rag_read',
      { documentId: hit.documentId, from: 2 }
    );
    expect(rest.sections.map((s) => s.headingPath)).toEqual(['Handbook › Invoices']);
    expect(rest.nextFrom).toBeNull();
  });

  it('search finds synced records, filtered by base', async () => {
    const kb = await createTable(baseId(), {
      name: 'Knowledges',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
      ],
    });
    try {
      const [title, context] = kb.fields.map((f) => f.id);
      const { records } = await createRecords(kb.id, {
        records: [{ fields: { [title]: 'VPN setup', [context]: 'Install the VPN client first.' } }],
      });
      const found = await until(
        () =>
          run<ISearchOut>('search', {
            query: 'VPN client',
            collections: ['kb_records'],
            baseIds: [baseId()],
          }),
        (o) => o.results.length > 0
      );
      expect(found.searched).toEqual(['kb_records']);
      expect(found.results[0]).toMatchObject({
        title: 'VPN setup',
        recordRef: { recordId: records[0].id },
      });
      const elsewhere = await run<ISearchOut>('search', {
        query: 'VPN client',
        collections: ['kb_records'],
        baseIds: ['bseNoSuchBase'],
      });
      expect(elsewhere.results).toEqual([]);
    } finally {
      await permanentDeleteTable(baseId(), kb.id);
    }
  });

  it('creates, lists and deletes collections; built-in ones stay', async () => {
    await run('collection_create', { id: 'work', label: 'Work', description: 'Projects' });
    const list = await run<{ collections: { id: string }[] }>('collection_list', {});
    expect(list.collections.map((c) => c.id)).toContain('work');
    await expect(run('collection_create', { id: 'work', label: 'Again' })).rejects.toThrow(
      /exists/
    );
    await run('rag_ingest', { collection: 'work', text: 'Project Falcon ships in May.' });
    expect(await run('collection_delete', { id: 'work' })).toEqual({ deleted: 'work' });
    expect(await rag.listDocuments('work')).toEqual([]);
    await expect(run('collection_delete', { id: 'knowledge' })).rejects.toThrow(/built in/);
    const out = await run<ISearchOut>('search', { query: 'Falcon', collections: ['work'] });
    expect(out.failed).toEqual([{ collection: 'work', error: 'no such collection' }]);
  });
});
