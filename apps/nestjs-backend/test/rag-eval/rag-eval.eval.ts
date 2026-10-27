/* eslint-disable no-console */
/**
 * Search evaluation (design §11.6, current-design §11): ingests the corpus (documents, knowledge
 * records and ordinary tables) into a disposable database, runs every golden question through the
 * search the agent uses, and prints recall@5, MRR@5 and latency, overall and per question kind.
 * Each question is asked twice: in its own collection, and across all of them (what `search` does
 * by default), which shows whether table rows push documents down. Gates: the recorded baseline
 * must not get worse; documents and knowledge records keep the results they had before every table
 * was indexed (recall@5 0.969, MRR@5 0.914); ordinary records reach recall@5 0.9.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@teable/db-main-prisma';
import knex from 'knex';
import { detectTableProfile } from '../../src/features/ai-data/ai-data.schema';
import { KnowledgeSearch } from '../../src/features/agent/application/knowledge/knowledge-search';
import {
  chunkDocument,
  chunkRecord,
} from '../../src/features/agent/infrastructure/knowledge/chunker';
import {
  documentIdFor,
  PgRagStore,
} from '../../src/features/agent/infrastructure/knowledge/pg-rag-store';
import { recordText } from '../../src/features/agent/infrastructure/knowledge/record-text';

interface IGolden {
  question: string;
  collection: string;
  expected: string[];
  kind: string;
}
interface ITableCorpus {
  tables: {
    id: string;
    name: string;
    fields: { id: string; name: string; type: string; primary?: boolean }[];
    rows: { id: string; cells: Record<string, string> }[];
  }[];
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
/** Documents and knowledge records, before every table was indexed (baseline of 2026-10-26). */
const knowledgeFloor = { recallAt5: 0.969, mrrAt5: 0.914 };
const recordsFloor = 0.9;
const allCollections = ['knowledge', 'kb_records', 'records'];

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
      ...(
        JSON.parse(readFileSync(path.join(corpus, 'tables.json'), 'utf8')) as ITableCorpus
      ).tables.flatMap((table) => {
        const fields = table.fields.map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          isPrimary: Boolean(f.primary),
          isComputed: false,
        }));
        const profile = detectTableProfile(fields);
        return table.rows.map((row) => {
          const read = recordText(fields, profile, row.cells, 'records')!;
          return {
            collectionId: 'records',
            sourceRef: `record:bseEval/${table.id}/${row.id}`,
            title: read.title,
            sections: chunkRecord(read.title, read.text),
            recordId: row.id,
            tableId: table.id,
          };
        });
      }),
    ];
    for (const item of items) {
      await store.upsertDocument({
        collectionId: item.collectionId,
        sourceRef: item.sourceRef,
        title: item.title,
        contentHash: 'eval',
        status: 'processing',
        baseId: item.recordId ? 'bseEval' : null,
        tableId: item.recordId ? ('tableId' in item ? item.tableId : 'tblEval') : null,
        recordId: item.recordId,
      });
      await store.replaceChunks(documentIdFor(item.collectionId, item.sourceRef), item.sections);
    }
    search = new KnowledgeSearch(store);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /** Over `questions`, each asked in its own collection, or in all of them (`mixed`). */
  const evaluate = async (questions: IGolden[], mixed = false): Promise<IMetrics> => {
    const latencies: number[] = [];
    let recall = 0;
    let mrr = 0;
    const kinds: Record<string, { hit: number; n: number }> = {};
    for (const g of questions) {
      const t0 = performance.now();
      const collections = mixed ? allCollections : [g.collection];
      const out = await search.search({ query: g.question, collections, topK });
      latencies.push(performance.now() - t0);
      const refs = out.results.map((r) => r.sourceRef);
      const found = g.expected.filter((e) => refs.includes(e)).length / g.expected.length;
      const rank = refs.findIndex((r) => g.expected.includes(r));
      recall += found;
      mrr += rank >= 0 ? 1 / (rank + 1) : 0;
      kinds[g.kind] ??= { hit: 0, n: 0 };
      kinds[g.kind].hit += found;
      kinds[g.kind].n += 1;
      if (!found) {
        console.log(
          `missed${mixed ? ' (mixed)' : ''}: ${g.question} → ${refs.join(', ') || '(nothing)'}`
        );
      }
    }
    return {
      recallAt5: round(recall / questions.length),
      mrrAt5: round(mrr / questions.length),
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      byKind: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, round(v.hit / v.n)])),
    };
  };

  it('measures full-text search against the baseline', async () => {
    const knowledgeQuestions = golden.filter((g) => g.collection !== 'records');
    const recordQuestions = golden.filter((g) => g.collection === 'records');
    const result = await evaluate(golden);
    const knowledge = await evaluate(knowledgeQuestions);
    const records = await evaluate(recordQuestions);
    const mixed = await evaluate(golden, true);
    const row = (m: IMetrics) => ({
      recallAt5: m.recallAt5,
      mrrAt5: m.mrrAt5,
      p50Ms: m.p50Ms,
      p95Ms: m.p95Ms,
      ...m.byKind,
    });
    console.log(`\nrag-eval: ${golden.length} questions, full-text search over every table`);
    console.table({
      all: row(result),
      knowledge: row(knowledge),
      records: row(records),
      mixed: row(mixed),
    });
    expect(knowledge.recallAt5).toBeGreaterThanOrEqual(knowledgeFloor.recallAt5);
    expect(knowledge.mrrAt5).toBeGreaterThanOrEqual(knowledgeFloor.mrrAt5);
    expect(records.recallAt5).toBeGreaterThanOrEqual(recordsFloor);

    const run = {
      date: new Date().toISOString().slice(0, 10),
      questions: golden.length,
      search: 'fulltext-all-tables',
      result,
      mixed,
    };
    const baseline = existsSync(baselinePath)
      ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as Partial<typeof run>)
      : undefined;
    if (baseline?.search !== run.search || process.env.RAG_EVAL_RECORD === '1') {
      writeFileSync(baselinePath, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`baseline recorded in ${baselinePath}`);
      return;
    }
    console.log(`recall@5 ${result.recallAt5} (baseline ${baseline.result!.recallAt5})`);
    expect(result.recallAt5).toBeGreaterThanOrEqual(baseline.result!.recallAt5);
    expect(mixed.recallAt5).toBeGreaterThanOrEqual(baseline.mixed!.recallAt5);
  });
});
