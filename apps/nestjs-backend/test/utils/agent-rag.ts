/**
 * Helpers for the knowledge e2e tests: the disposable agent_rag_test database, a deterministic
 * embedding model and polling.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { MockEmbeddingModelV3 } from 'ai/test';
import knex from 'knex';

/** agent_rag_test next to the e2e database; refuses anything but the local disposable container. */
export const ragTestUrl = () => {
  const env = readFileSync(path.join(__dirname, '../../../nextjs-app/.env.test'), 'utf8');
  const prisma = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1];
  const url = prisma.replace(/\/[^/?]+(?:\?.*)?$/, '/agent_rag_test');
  if (!url.includes('@127.0.0.1:5432/'))
    throw new Error('agent_rag_test must be the local disposable DB');
  return url;
};

/** agent_rag_test without the agent_rag schema; returns its URL. */
export const freshRagTestDb = async () => {
  const url = ragTestUrl();
  const admin = knex({ client: 'pg', connection: url });
  await admin.raw('DROP SCHEMA IF EXISTS agent_rag CASCADE');
  await admin.destroy();
  return url;
};

/** Bag of words hashed into 16 dimensions: texts sharing words point the same way. */
export const fakeVector = (text: string) => {
  const v = new Array(16).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 16;
    v[h] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

/** An embedding model over fakeVector; `seen` collects every embedded text. */
export const fakeEmbeddingModel = (seen: string[] = []) =>
  new MockEmbeddingModelV3({
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => {
      seen.push(...values);
      return { embeddings: values.map(fakeVector), warnings: [] };
    },
  });

export const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  let value = await fn();
  while (!ok(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    value = await fn();
  }
  return value;
};
