/* eslint-disable no-console */
/**
 * Knowledge search evaluation (design §11.6): ingests the corpus into a disposable database, runs
 * every golden question through the search the agent uses, and prints recall@5, MRR@5 and
 * latency, overall and per question kind. The recorded baseline must not get worse, and recall@5
 * must stay at or above 0.938, the keyword-only result before vector search was removed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@teable/db-main-prisma';
import knex from 'knex';
import { KnowledgeSearch } from '../../src/features/agent/application/knowledge/knowledge-search';
import {
  chunkDocument,
  chunkRecord,
} from '../../src/features/agent/infrastructure/knowledge/chunker';
import {
  documentIdFor,
  PgRagStore,
} from '../../src/features/agent/infrastructure/knowledge/pg-rag-store';

interface IGolden {
  question: string;
  collection: string;
  expected: string[];
  kind: string;
}
interface IMetrics {
  recallAt5: number;
  mrrAt5: number;
  p50Ms: number;
  p95Ms: number;
  byKind: Record<string, number>;
}

const dir = __dirname;
const baselinePath = path.join(dir, 'baseline.json');
const topK = 5;
/** Keyword-only recall@5 measured before vector search was removed. */
const recallFloor = 0.938;

const evalDbUrl = async () => {
  if (process.env.RAG_EVAL_DATABASE_URL) return process.env.RAG_EVAL_DATABASE_URL;
  const env = readFileSync(path.join(dir, '../../../nextjs-app/.env.test'), 'utf8');
  const main = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1].replace(/\?.*$/, '');
  if (!main.includes('@127.0.0.1:5432/'))
    throw new Error('rag-eval runs on the local disposable DB');
  const admin = knex({ client: 'pg', connection: main });
  const exists = await admin.raw(`select 1 from pg_database where datname = 'agent_rag_eval'`);
  if (!exists.rows.length) await admin.raw('CREATE DATABASE agent_rag_eval');
  await admin.destroy();
  return main.replace(/\/[^/?]+$/, '/agent_rag_eval');
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

describe('knowledge search evaluation', () => {
  const golden = (
    JSON.parse(readFileSync(path.join(dir, 'golden.json'), 'utf8')) as { entries: IGolden[] }
  ).entries;
  let prisma: PrismaClient;
  let store: PgRagStore;
  let search: KnowledgeSearch;

  beforeAll(async () => {
    const url = await evalDbUrl();
    prisma = new PrismaClient({ datasourceUrl: url });
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS agent_rag CASCADE');
    store = new PgRagStore(prisma as never);

    const corpus = path.join(dir, 'corpus');
    const items = [
      ...readdirSync(corpus)
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const text = readFileSync(path.join(corpus, f), 'utf8');
          return {
            collectionId: 'knowledge',
            sourceRef: `text:${f.replace(/\.md$/, '')}`,
            title: /^# (.*)$/m.exec(text)?.[1] ?? f,
            sections: chunkDocument(text, 'markdown'),
            recordId: null as string | null,
          };
        }),
      ...(
        JSON.parse(readFileSync(path.join(corpus, 'records.json'), 'utf8')) as {
          id: string;
          title: string;
          body: string;
        }[]
      ).map((r) => ({
        collectionId: 'kb_records',
        sourceRef: `record:bseEval/tblEval/${r.id}`,
        title: r.title,
        sections: chunkRecord(r.title, r.body),
        recordId: r.id,
      })),
    ];
    for (const item of items) {
      await store.upsertDocument({
        collectionId: item.collectionId,
        sourceRef: item.sourceRef,
        title: item.title,
        contentHash: 'eval',
        status: 'processing',
        baseId: item.recordId ? 'bseEval' : null,
        tableId: item.recordId ? 'tblEval' : null,
        recordId: item.recordId,
      });
      await store.replaceChunks(documentIdFor(item.collectionId, item.sourceRef), item.sections);
    }
    search = new KnowledgeSearch(store);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const evaluate = async (): Promise<IMetrics> => {
    const latencies: number[] = [];
    let recall = 0;
    let mrr = 0;
    const kinds: Record<string, { hit: number; n: number }> = {};
    for (const g of golden) {
      const t0 = performance.now();
      const out = await search.search({ query: g.question, collections: [g.collection], topK });
      latencies.push(performance.now() - t0);
      const refs = out.results.map((r) => r.sourceRef);
      const found = g.expected.filter((e) => refs.includes(e)).length / g.expected.length;
      const rank = refs.findIndex((r) => g.expected.includes(r));
      recall += found;
      mrr += rank >= 0 ? 1 / (rank + 1) : 0;
      kinds[g.kind] ??= { hit: 0, n: 0 };
      kinds[g.kind].hit += found;
      kinds[g.kind].n += 1;
      if (!found) console.log(`missed: ${g.question} → ${refs.join(', ') || '(nothing)'}`);
    }
    return {
      recallAt5: round(recall / golden.length),
      mrrAt5: round(mrr / golden.length),
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      byKind: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, round(v.hit / v.n)])),
    };
  };

  it('measures full-text search against the baseline', async () => {
    const result = await evaluate();
    console.log(`\nrag-eval: ${golden.length} questions, full-text search`);
    console.table({
      fulltext: {
        recallAt5: result.recallAt5,
        mrrAt5: result.mrrAt5,
        p50Ms: result.p50Ms,
        p95Ms: result.p95Ms,
        ...result.byKind,
      },
    });
    expect(result.recallAt5).toBeGreaterThanOrEqual(recallFloor);

    const run = {
      date: new Date().toISOString().slice(0, 10),
      questions: golden.length,
      search: 'fulltext',
      result,
    };
    const baseline = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<typeof run>)
      : undefined;
    if (baseline?.search !== 'fulltext' || process.env.RAG_EVAL_RECORD === '1') {
      writeFileSync(baselinePath, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`baseline recorded in ${baselinePath}`);
      return;
    }
    console.log(`recall@5 ${result.recallAt5} (baseline ${baseline.result!.recallAt5})`);
    expect(result.recallAt5).toBeGreaterThanOrEqual(baseline.result!.recallAt5);
  });
});
