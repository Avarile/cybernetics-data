/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
/**
 * AI data access, end to end over HTTP through the global guards:
 * the internal endpoint the Mastra service calls (POST /api/internal/ai-data/:op),
 * acting as the chatting user via a per-turn context token.
 *
 * Covers permission enforcement per role (owner, editor, viewer, outsider), base
 * scoping, context-token forgery and replay, soft-delete filtering, and the knowledge
 * agent's two-round search payloads (CYBERDATA-9, CYBERDATA-13).
 *
 * Runs on the e2e test database (seeded by pre-test-e2e), never on a working database.
 * Locally, also blank the Redis settings: the backend's ConfigModule always reads
 * apps/nextjs-app/.env.development.local, and a shared performance cache would serve
 * that instance's settings (e.g. email verification) to the test app:
 *   NODE_ENV=test BACKEND_PERFORMANCE_CACHE= BACKEND_CACHE_REDIS_URI= \
 *   PRISMA_DATABASE_URL=<test db> npx vitest run --config ./vitest-e2e.config.ts test/ai-data.e2e-spec.ts
 */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Role } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { emailBaseInvitation, USER_ME } from '@teable/openapi';
import { AiDataContextService } from '../src/features/ai-data/ai-data-context.service';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { createBase, createTable, initApp, permanentDeleteBase } from './utils/init-app';

// The internal endpoint only exists when the Mastra service key is configured.
const SERVICE_KEY = 'e2e-mastra-service-key';
process.env.MASTRA_API_KEY = SERVICE_KEY;

const KNOWLEDGE = [
  { title: 'TypeScript generics', context: 'Generic types let functions keep type information.' },
  { title: 'TypeScript narrowing', context: 'Type guards narrow a union inside a branch.' },
  { title: 'Postgres indexes', context: 'B-tree indexes speed up equality and range lookups.' },
  {
    title: 'TypeScript decorators (retired)',
    context: 'Soft-deleted entry.',
    deleted_at: '2026-01-01T00:00:00.000Z',
  },
];

describe('AI data access (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let contexts: AiDataContextService;
  let baseA: string;
  let baseB: string;
  let knowledge: ITableFullVo;
  let secret: ITableFullVo;
  const users = { owner: '', editor: '', viewer: '', outsider: '' };

  const call = async (op: string, body: unknown, headers: Record<string, string>) => {
    const res = await fetch(`${url}/api/internal/ai-data/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  };
  const auth = (token?: string) => ({
    authorization: `Bearer ${SERVICE_KEY}`,
    ...(token ? { 'x-ai-data-context': token } : {}),
  });
  /** Issue a context for one call sequence and always revoke it. */
  const as = async <T>(userId: string, baseId: string, fn: (token: string) => Promise<T>) => {
    const { token } = await contexts.issue(userId, baseId);
    try {
      return await fn(token);
    } finally {
      await contexts.revoke(token);
    }
  };

  const signUp = async (email: string) => {
    const client = await createNewUserAxios({ email, password: 'AiDataE2e123!' });
    return { client, id: (await client.get(USER_ME)).data.id as string };
  };

  beforeAll(async () => {
    const ctx = await initApp();
    app = ctx.app;
    url = ctx.appUrl;
    contexts = app.get(AiDataContextService);
    users.owner = globalThis.testConfig.userId;

    baseA = (await createBase({ spaceId: globalThis.testConfig.spaceId, name: 'ai-data A' })).id;
    baseB = (await createBase({ spaceId: globalThis.testConfig.spaceId, name: 'ai-data B' })).id;

    knowledge = await createTable(baseA, {
      name: 'knowledges',
      fields: [
        { name: 'title', type: FieldType.SingleLineText },
        { name: 'context', type: FieldType.LongText },
        { name: 'deleted_at', type: FieldType.Date },
      ],
      records: KNOWLEDGE.map((fields) => ({ fields })),
    });
    secret = await createTable(baseB, {
      name: 'knowledges', // same name as in base A on purpose
      fields: [{ name: 'title', type: FieldType.SingleLineText }],
      records: [{ fields: { title: 'Base B secret' } }],
    });

    const editor = await signUp('ai-data-editor@e2e.com');
    const viewer = await signUp('ai-data-viewer@e2e.com');
    const outsider = await signUp('ai-data-outsider@e2e.com');
    users.editor = editor.id;
    users.viewer = viewer.id;
    users.outsider = outsider.id;
    await emailBaseInvitation({
      baseId: baseA,
      emailBaseInvitationRo: { role: Role.Editor, emails: ['ai-data-editor@e2e.com'] },
    });
    await emailBaseInvitation({
      baseId: baseA,
      emailBaseInvitationRo: { role: Role.Viewer, emails: ['ai-data-viewer@e2e.com'] },
    });
  });

  afterAll(async () => {
    if (baseA) await permanentDeleteBase(baseA);
    if (baseB) await permanentDeleteBase(baseB);
    // Close the app so Prisma shuts down before the worker exits; otherwise its query
    // engine can panic during teardown while base deletion work is still running.
    await app?.close();
  });

  describe('who can read', () => {
    it.each(['owner', 'editor', 'viewer'] as const)(
      'the %s of base A can read it',
      async (role) => {
        const result = await as(users[role], baseA, (t) =>
          call('query-records', { tableId: 'knowledges', fieldKeyType: 'name' }, auth(t))
        );
        expect(result.status).toBe(200);
        expect(result.json.records.map((r: any) => r.fields.title).sort()).toEqual(
          KNOWLEDGE.filter((k) => !k.deleted_at)
            .map((k) => k.title)
            .sort()
        );
      }
    );

    it('a user with no role on base A is refused, for any table name', async () => {
      const existing = await as(users.outsider, baseA, (t) =>
        call('describe-table', { tableId: 'knowledges' }, auth(t))
      );
      const missing = await as(users.outsider, baseA, (t) =>
        call('describe-table', { tableId: 'nope' }, auth(t))
      );
      const list = await as(users.outsider, baseA, (t) => call('list-tables', {}, auth(t)));
      expect([existing.status, missing.status, list.status]).toEqual([403, 403, 403]);
    });

    it('base A members cannot read base B', async () => {
      const result = await as(users.editor, baseB, (t) => call('list-tables', {}, auth(t)));
      expect(result.status).toBe(403);
    });
  });

  describe('base scoping', () => {
    it("a table name resolves inside the context's base, even when another base has it", async () => {
      const desc = await as(users.owner, baseA, (t) =>
        call('describe-table', { tableId: 'knowledges' }, auth(t))
      );
      expect(desc.json.id).toBe(knowledge.id);
      expect(desc.json.id).not.toBe(secret.id);
    });

    it("another base's table id is not found, whatever the user may read elsewhere", async () => {
      // The owner can read base B, but this context is for base A.
      const byId = await as(users.owner, baseA, (t) =>
        call('query-records', { tableId: secret.id }, auth(t))
      );
      const byRecords = await as(users.owner, baseA, (t) =>
        call('get-records', { tableId: secret.id, recordIds: [secret.records[0].id] }, auth(t))
      );
      expect([byId.status, byRecords.status]).toEqual([404, 404]);
      expect(byId.json.message).toBe('Table not found');
    });

    it('a base id in the body is rejected', async () => {
      const result = await as(users.owner, baseA, (t) =>
        call('query-records', { tableId: 'knowledges', baseId: baseB }, auth(t))
      );
      expect(result.status).toBe(400);
    });
  });

  describe('context token', () => {
    it('requires the Mastra service key and a live token issued by this backend', async () => {
      const { token } = await contexts.issue(users.owner, baseA);
      const results = {
        noBearer: (await call('list-tables', {}, { 'x-ai-data-context': token })).status,
        wrongBearer: (
          await call(
            'list-tables',
            {},
            {
              authorization: 'Bearer wrong',
              'x-ai-data-context': token,
            }
          )
        ).status,
        noToken: (await call('list-tables', {}, auth())).status,
        malformed: (await call('list-tables', {}, auth('not-a-token'))).status,
        unknown: (await call('list-tables', {}, auth('A'.repeat(43)))).status,
        genuine: (await call('list-tables', {}, auth(token))).status,
      };
      await contexts.revoke(token);
      const replayed = (await call('list-tables', {}, auth(token))).status;
      expect(results).toEqual({
        noBearer: 401,
        wrongBearer: 401,
        noToken: 401,
        malformed: 401,
        unknown: 401,
        genuine: 200,
      });
      expect(replayed).toBe(401);
    });

    it('a token for a user that does not exist is refused', async () => {
      const result = await as('usrDoesNotExist001', baseA, (t) => call('list-tables', {}, auth(t)));
      expect(result.status).toBe(401);
    });
  });

  describe('soft delete', () => {
    it('leaves deleted_at rows out by default and returns them on request', async () => {
      const titles = async (includeDeleted: boolean) => {
        const r = await as(users.viewer, baseA, (t) =>
          call(
            'query-records',
            { tableId: 'knowledges', fieldKeyType: 'name', includeDeleted, projection: ['title'] },
            auth(t)
          )
        );
        expect(r.status).toBe(200);
        return {
          excluded: r.json.softDeletedExcluded,
          titles: r.json.records.map((x: any) => x.fields.title),
        };
      };
      const live = await titles(false);
      const all = await titles(true);
      expect(live.excluded).toBe(true);
      expect(live.titles).not.toContain('TypeScript decorators (retired)');
      expect(all.excluded).toBe(false);
      expect(all.titles).toContain('TypeScript decorators (retired)');
    });
  });

  describe("knowledge agent's two-round search (Mastra payloads)", () => {
    // These are the exact bodies the Mastra search-*-titles / get-*-contexts tools send.
    const searchTitles = (keyword: string) => ({
      tableId: 'knowledges',
      take: 20,
      fieldKeyType: 'name',
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'title', operator: 'contains', value: keyword }],
      },
    });
    const getContexts = (recordIds: string[]) => ({
      tableId: 'knowledges',
      recordIds,
      fieldKeyType: 'name',
    });

    it.each(['viewer', 'owner'] as const)(
      'as the %s: round 1 finds matching live titles, round 2 returns their context',
      async (role) => {
        await as(users[role], baseA, async (t) => {
          const round1 = await call('query-records', searchTitles('TypeScript'), auth(t));
          expect(round1.status).toBe(200);
          const found = round1.json.records.map((r: any) => ({ id: r.id, title: r.fields.title }));
          expect(found.map((f: any) => f.title).sort()).toEqual([
            'TypeScript generics',
            'TypeScript narrowing',
          ]);

          const round2 = await call(
            'get-records',
            getContexts(found.map((f: any) => f.id)),
            auth(t)
          );
          expect(round2.status).toBe(200);
          expect(round2.json.missingIds).toEqual([]);
          const contextByTitle = Object.fromEntries(
            round2.json.records.map((r: any) => [r.fields.title, r.fields.context])
          );
          for (const k of KNOWLEDGE.filter(
            (x) => x.title.startsWith('TypeScript') && !x.deleted_at
          )) {
            expect(contextByTitle[k.title]).toBe(k.context);
          }
        });
      }
    );

    it('round 1 with no match returns nothing rather than failing', async () => {
      const result = await as(users.viewer, baseA, (t) =>
        call('query-records', searchTitles('Kubernetes'), auth(t))
      );
      expect(result.status).toBe(200);
      expect(result.json.records).toEqual([]);
    });
  });
});
