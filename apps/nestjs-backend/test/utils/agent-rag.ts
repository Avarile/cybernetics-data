/**
 * Helpers for the knowledge e2e tests: a clean agent_rag schema in the disposable e2e database,
 * and polling.
 */
import { readFileSync } from 'fs';
import path from 'path';
import knex from 'knex';

/** The e2e database; refuses anything but the local disposable container. */
export const e2eDatabaseUrl = () => {
  const env = readFileSync(path.join(__dirname, '../../../nextjs-app/.env.test'), 'utf8');
  const url = /^PRISMA_DATABASE_URL=(.*)$/m.exec(env)![1];
  if (!url.includes('@127.0.0.1:5432/'))
    throw new Error('knowledge e2e tests run on the local disposable DB only');
  return url.replace(/\?.*$/, '');
};

/** Drop the agent_rag schema, so the app under test creates it afresh. */
export const freshRagSchema = async () => {
  const db = knex({ client: 'pg', connection: e2eDatabaseUrl() });
  await db.raw('DROP SCHEMA IF EXISTS agent_rag CASCADE');
  await db.destroy();
};

export const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  let value = await fn();
  while (!ok(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    value = await fn();
  }
  return value;
};
