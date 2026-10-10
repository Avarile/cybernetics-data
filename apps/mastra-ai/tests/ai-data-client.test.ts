import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiDataClient,
  aiDataClient,
  canWrite,
} from '../src/mastra/tools/db-query/ai-data-client.js';
import { searchKnowledgeTitlesTool } from '../src/mastra/tools/db-query/db-search-tools.js';

const token = 'opaque-token-for-this-turn';
const contextWith = (values: Record<string, unknown>) => ({
  requestContext: { get: (key: string) => values[key] },
});

type Call = { url: string; init: RequestInit; body: any };

function stubFetch(respond: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init, body: JSON.parse(String(init.body)) };
      calls.push(call);
      const { status = 200, json } = respond(call);
      return new Response(JSON.stringify(json), { status });
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aiDataClient / canWrite', () => {
  it('refuses to build a client without the per-turn token', () => {
    expect(() => aiDataClient(undefined)).toThrow(/No user context/);
    expect(() => aiDataClient(contextWith({}))).toThrow(/No user context/);
    expect(aiDataClient(contextWith({ aiDataContext: token }))).toBeInstanceOf(AiDataClient);
  });

  it('only treats an explicit true as write permission', () => {
    expect(canWrite(contextWith({ canWrite: true }))).toBe(true);
    for (const value of [false, 'true', 1, undefined]) {
      expect(canWrite(contextWith({ canWrite: value }))).toBe(false);
    }
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('AiDataClient', () => {
  const client = new AiDataClient(token, 'http://backend.internal:3000/', 'service-key');

  it('calls the internal endpoint as the Mastra service, with the turn token, keyed by name', async () => {
    const calls = stubFetch(() => ({ json: { records: [], returned: 0, hasMore: false } }));
    await client.queryRecords('knowledges', { take: 500, search: 'x' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://backend.internal:3000/api/internal/ai-data/query-records');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer service-key');
    expect(headers['x-ai-data-context']).toBe(token);
    expect(calls[0].body).toEqual({
      tableId: 'knowledges',
      search: 'x',
      take: 50,
      fieldKeyType: 'name',
    });
  });

  it('fetches any number of ids in batches of 50, de-duplicated, in the order asked', async () => {
    const calls = stubFetch(({ body }) => ({
      json: { records: body.recordIds.map((id: string) => ({ id, fields: {} })) },
    }));
    const ids = Array.from({ length: 120 }, (_, i) => `rec${i}`);
    const records = await client.getRecordsByIds('tasks', [...ids, 'rec5', '']);

    expect(calls.map((c) => c.body.recordIds.length)).toEqual([50, 50, 20]);
    expect(records.map((r) => r.id)).toEqual(ids);
  });

  it('surfaces the backend message on failure', async () => {
    stubFetch(() => ({
      status: 403,
      json: { message: 'you have no permission to access this base' },
    }));
    await expect(client.listTables()).rejects.toThrow(
      'Data lookup failed (403): you have no permission to access this base'
    );
  });
});

describe('a read tool', () => {
  it('search-knowledge-titles filters the title by name and maps the knowledge type link', async () => {
    const calls = stubFetch(() => ({
      json: {
        records: [
          {
            id: 'rec1',
            fields: { title: 'TypeScript generics', knowledge_type: { id: 'recT', title: 'Note' } },
          },
        ],
        returned: 1,
        hasMore: false,
      },
    }));
    const result = await searchKnowledgeTitlesTool.execute!(
      { keyword: 'TypeScript', take: 5 },
      contextWith({ aiDataContext: token }) as never
    );

    expect(calls[0].body).toMatchObject({
      tableId: 'knowledges',
      take: 5,
      fieldKeyType: 'name',
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'title', operator: 'contains', value: 'TypeScript' }],
      },
    });
    expect(result).toEqual({
      results: [{ id: 'rec1', title: 'TypeScript generics', knowledge_type: 'Note' }],
      total: 1,
    });
  });
});
