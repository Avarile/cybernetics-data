/* eslint-disable no-console */
/**
 * Knowledge search evaluation (design §11.6): ingests the corpus into a disposable database, runs
 * every golden question through the search pipeline the agent uses, and prints recall@5, MRR@5
 * and latency for keyword, vector, hybrid and hybrid + rerank. The first run is the baseline;
 * hybrid recall@5 must not fall below it.
 *
 * With AI_GATEWAY_API_KEY set, real models are used (RAG_EVAL_EMBEDDING, default
 * openai/text-embedding-3-small; RAG_EVAL_RERANK, default cohere/rerank-v3.5). Without it, a
 * deterministic word-hash embedding is used and the rerank configuration is skipped.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { createGateway, embedMany, type EmbeddingModel, type RerankingModel } from 'ai';
import knex from 'knex';
import type { IAgentConfig } from '../../src/configs/agent.config';
import type { EmbeddingSpaces } from '../../src/features/agent/application/knowledge/embedding-spaces';
import { KnowledgeSearch } from '../../src/features/agent/application/knowledge/knowledge-search';
import type { IModelPort } from '../../src/features/agent/domain/ports';
import {
  chunkDocument,
  chunkRecord,
} from '../../src/features/agent/infrastructure/knowledge/chunker';
import {
  documentIdFor,
  embeddingText,
  PgRagStore,
} from '../../src/features/agent/infrastructure/knowledge/pg-rag-store';
import { fakeEmbeddingModel } from '../utils/agent-rag';

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
const evalTable = 'record:bseEval/tblEval/';

const evalDbUrl = async () => {
  if (process.env.RAG_EVAL_DATABASE_URL) return process.env.RAG_EVAL_DATABASE_URL;
  const env = readFileSync(path.join(dir, '../../../nextjs-app/.env.test'), 'utf8');
  const main = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1];
  if (!main.includes('@127.0.0.1:5432/'))
    throw new Error('rag-eval runs on the local disposable DB');
  const admin = knex({ client: 'pg', connection: main });
  const exists = await admin.raw(`select 1 from pg_database where datname = 'agent_rag_eval'`);
  if (!exists.rows.length) await admin.raw('CREATE DATABASE agent_rag_eval');
  await admin.destroy();
  return main.replace(/\/[^/?]+(?:\?.*)?$/, '/agent_rag_eval');
};

const models = () => {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return { embedding: 'fake/word-hash', embedder: fakeEmbeddingModel(), reranking: null };
  }
  const gateway = createGateway({ apiKey });
  const embedding = process.env.RAG_EVAL_EMBEDDING || 'openai/text-embedding-3-small';
  const reranking = process.env.RAG_EVAL_RERANK || 'cohere/rerank-v3.5';
  return {
    embedding,
    embedder: gateway.embeddingModel(embedding) as EmbeddingModel,
    reranking: { id: reranking, model: gateway.rerankingModel(reranking) as RerankingModel },
  };
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

describe('knowledge search evaluation', () => {
  const golden = (
    JSON.parse(readFileSync(path.join(dir, 'golden.json'), 'utf8')) as {
      entries: IGolden[];
    }
  ).entries;
  const m = models();
  let store: PgRagStore;
  let search: KnowledgeSearch;

  const embed = async (texts: string[]) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const { embeddings } = await embedMany({
        model: m.embedder,
        values: texts.slice(i, i + 100),
      });
      out.push(...embeddings);
    }
    return out;
  };

  beforeAll(async () => {
    const url = await evalDbUrl();
    const admin = knex({ client: 'pg', connection: url });
    await admin.raw('DROP SCHEMA IF EXISTS agent_rag CASCADE');
    await admin.destroy();
    store = new PgRagStore({ ragDatabaseUrl: url } as IAgentConfig);

    const [probe] = await embed(['dimension probe']);
    const space = await store.ensureSpace(m.embedding, probe.length, 'building');
    await store.activateSpace(space.slug);

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
        sourceRef: `${evalTable}${r.id}`,
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
      const texts = item.sections.flatMap((s) =>
        s.chunks.map((c) => embeddingText(item.title, s.headingPath, c))
      );
      await store.replaceChunks(documentIdFor(item.collectionId, item.sourceRef), item.sections, [
        { space: space.slug, vectors: await embed(texts) },
      ]);
    }

    const modelPort = {
      reranker: async (ref: string) => ({ ref, modelKey: ref, model: m.reranking!.model }),
    } as unknown as IModelPort;
    const spaces = { embed: (_ref: string, texts: string[]) => embed(texts) } as EmbeddingSpaces;
    search = new KnowledgeSearch(store, modelPort, spaces);
  });

  afterAll(async () => {
    await store?.onModuleDestroy();
  });

  const evaluate = async (
    mode: 'keyword' | 'vector' | 'hybrid',
    rerank: boolean
  ): Promise<IMetrics> => {
    const latencies: number[] = [];
    let recall = 0;
    let mrr = 0;
    const kinds: Record<string, { hit: number; n: number }> = {};
    for (const g of golden) {
      const t0 = performance.now();
      const out = await search.search({
        query: g.question,
        collections: [g.collection],
        topK,
        mode,
        rerankModel: rerank ? m.reranking!.id : null,
      });
      latencies.push(performance.now() - t0);
      const refs = out.results.map((r) => r.sourceRef);
      const found = g.expected.filter((e) => refs.includes(e)).length / g.expected.length;
      const rank = refs.findIndex((r) => g.expected.includes(r));
      recall += found;
      mrr += rank >= 0 ? 1 / (rank + 1) : 0;
      kinds[g.kind] ??= { hit: 0, n: 0 };
      kinds[g.kind].hit += found;
      kinds[g.kind].n += 1;
    }
    return {
      recallAt5: round(recall / golden.length),
      mrrAt5: round(mrr / golden.length),
      p50Ms: Math.round(percentile(latencies, 50)),
      p95Ms: Math.round(percentile(latencies, 95)),
      byKind: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, round(v.hit / v.n)])),
    };
  };

  it('measures every configuration against the baseline', async () => {
    const results: Record<string, IMetrics | 'skipped'> = {
      keyword: await evaluate('keyword', false),
      vector: await evaluate('vector', false),
      hybrid: await evaluate('hybrid', false),
      hybridRerank: m.reranking ? await evaluate('hybrid', true) : 'skipped',
    };
    console.log(
      `\nrag-eval: ${golden.length} questions, embedding ${m.embedding}, rerank ${m.reranking?.id ?? 'none'}`
    );
    console.table(
      Object.fromEntries(
        Object.entries(results).map(([k, v]) => [
          k,
          v === 'skipped'
            ? { recallAt5: 'skipped' }
            : {
                recallAt5: v.recallAt5,
                mrrAt5: v.mrrAt5,
                p50Ms: v.p50Ms,
                p95Ms: v.p95Ms,
                ...v.byKind,
              },
        ])
      )
    );

    const run = {
      date: new Date().toISOString().slice(0, 10),
      questions: golden.length,
      embedding: m.embedding,
      rerank: m.reranking?.id ?? null,
      results,
    };
    const hybrid = results.hybrid as IMetrics;
    if (!existsSync(baselinePath) || process.env.RAG_EVAL_RECORD === '1') {
      writeFileSync(baselinePath, `${JSON.stringify(run, null, 2)}\n`);
      console.log(`baseline recorded in ${baselinePath}`);
      return;
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof run;
    if (baseline.embedding !== m.embedding) {
      console.log(`baseline used ${baseline.embedding}; not comparable with ${m.embedding}`);
      return;
    }
    const base = baseline.results.hybrid as IMetrics;
    console.log(`hybrid recall@5 ${hybrid.recallAt5} (baseline ${base.recallAt5})`);
    expect(hybrid.recallAt5).toBeGreaterThanOrEqual(base.recallAt5);
  });
});
