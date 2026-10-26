/* eslint-disable sonarjs/no-duplicate-string, @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
/**
 * AI data access (AiDataService), acting as a user: the read-as-user semantics the MCP server
 * relies on. Covers permission enforcement per role (owner, editor, viewer, outsider), base
 * scoping, soft-delete filtering, and a two-round title/context search (CYBERDATA-9, -13).
 * The Mastra internal endpoint this suite used to drive was removed with Mastra (design §14.4).
 *
 * Runs on the e2e test database (seeded by pre-test-e2e), never on a working database.
 */
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
import { FieldType, Role } from '@cybernetics/core';
import type { INestApplication } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { ITableFullVo } from '@teable/openapi';
import { emailBaseInvitation, USER_ME } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { AiDataService } from '../src/features/ai-data/ai-data.service';
import type { IClsStore } from '../src/types/cls';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  createBase,
  createTable,
  initApp,
  permanentDeleteBase,
  runWithTestUser,
} from './utils/init-app';

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
  let data: AiDataService;
  let cls: ClsService<IClsStore>;
  let baseA: string;
  let baseB: string;
  let knowledge: ITableFullVo;
  let secret: ITableFullVo;
  const users = { owner: '', editor: '', viewer: '', outsider: '' };

  /** One operation as a user in a base, with the HTTP status it would answer. */
  const call = async (userId: string, baseId: string, op: string, body: any) => {
    const run = (): Promise<unknown> => {
      switch (op) {
        case 'list-tables':
          return data.listTables(baseId);
        case 'describe-table':
          return data.describeTable(baseId, body.tableId);
        case 'query-records':
          return data.queryRecords(baseId, body);
        case 'get-records':
          return data.getRecords(baseId, body.tableId, body.recordIds, {
            fieldKeyType: body.fieldKeyType,
          });
        default:
          throw new Error(op);
      }
    };
    try {
      const json: any = await runWithTestUser(cls, run, { id: userId });
      return { status: 200, json };
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), json: { message: error.message } };
    }
  };

  const signUp = async (email: string) => {
    const client = await createNewUserAxios({ email, password: 'AiDataE2e123!' });
    return { client, id: (await client.get(USER_ME)).data.id as string };
  };

  beforeAll(async () => {
    app = (await initApp()).app;
    data = app.get(AiDataService);
    cls = app.get<ClsService<IClsStore>>(ClsService);
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
        const result = await call(users[role], baseA, 'query-records', {
          tableId: 'knowledges',
          fieldKeyType: 'name',
        });
        expect(result.status).toBe(200);
        expect(result.json.records.map((r: any) => r.fields.title).sort()).toEqual(
          KNOWLEDGE.filter((k) => !k.deleted_at)
            .map((k) => k.title)
            .sort()
        );
      }
    );

    it('a user with no role on base A is refused, for any table name', async () => {
      const existing = await call(users.outsider, baseA, 'describe-table', {
        tableId: 'knowledges',
      });
      const missing = await call(users.outsider, baseA, 'describe-table', { tableId: 'nope' });
      const list = await call(users.outsider, baseA, 'list-tables', {});
      expect([existing.status, missing.status, list.status]).toEqual([403, 403, 403]);
    });

    it('base A members cannot read base B', async () => {
      const result = await call(users.editor, baseB, 'list-tables', {});
      expect(result.status).toBe(403);
    });
  });

  describe('base scoping', () => {
    it("a table name resolves inside the context's base, even when another base has it", async () => {
      const desc = await call(users.owner, baseA, 'describe-table', { tableId: 'knowledges' });
      expect(desc.json.id).toBe(knowledge.id);
      expect(desc.json.id).not.toBe(secret.id);
    });

    it("another base's table id is not found, whatever the user may read elsewhere", async () => {
      // The owner can read base B, but this context is for base A.
      const byId = await call(users.owner, baseA, 'query-records', { tableId: secret.id });
      const byRecords = await call(users.owner, baseA, 'get-records', {
        tableId: secret.id,
        recordIds: [secret.records[0].id],
      });
      expect([byId.status, byRecords.status]).toEqual([404, 404]);
      expect(byId.json.message).toBe('Table not found');
    });
  });

  describe('soft delete', () => {
    it('leaves deleted_at rows out by default and returns them on request', async () => {
      const titles = async (includeDeleted: boolean) => {
        const r = await call(users.viewer, baseA, 'query-records', {
          tableId: 'knowledges',
          fieldKeyType: 'name',
          includeDeleted,
          projection: ['title'],
        });
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

  describe('two-round search: titles first, then their context', () => {
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
        {
          const round1 = await call(
            users[role],
            baseA,
            'query-records',
            searchTitles('TypeScript')
          );
          expect(round1.status).toBe(200);
          const found = round1.json.records.map((r: any) => ({ id: r.id, title: r.fields.title }));
          expect(found.map((f: any) => f.title).sort()).toEqual([
            'TypeScript generics',
            'TypeScript narrowing',
          ]);

          const round2 = await call(
            users[role],
            baseA,
            'get-records',
            getContexts(found.map((f: any) => f.id))
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
        }
      }
    );

    it('round 1 with no match returns nothing rather than failing', async () => {
      const result = await call(users.viewer, baseA, 'query-records', searchTitles('Kubernetes'));
      expect(result.status).toBe(200);
      expect(result.json.records).toEqual([]);
    });
  });
});
