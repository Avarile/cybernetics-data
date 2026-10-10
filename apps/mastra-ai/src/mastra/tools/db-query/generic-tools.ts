import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { aiDataClient } from './ai-data-client.js';
import type { AiDataFilter } from './ai-data-client.js';
import { TABLES, listRecords } from './ai-data-reads.js';

/**
 * Schema-agnostic tools for the Reactive agent. The read tools go through the Teable
 * backend as the chatting user (see ai-data-client.ts), scoped to the chat's base.
 */

// ── Shared zod shapes (mirror db-query-tools.ts) ─────────────────────────────

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });
const listOutput = z.object({ records: z.array(recordSchema), total: z.number() });

/** Parse a JSON string argument; a clear error beats a silently ignored filter. */
function parseJsonArg<T>(name: string, raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${name} must be a JSON string, e.g. {"conjunction":"and","filterSet":[]}`);
  }
}

// ── discover-tables ──────────────────────────────────────────────────────────

export const discoverTablesTool = createTool({
  id: 'discover-tables',
  description:
    'List every table in the current base, with id, name, description, and any ' +
    'curated context/notes from the table-references registry. Use this FIRST to find ' +
    'which table to work with.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    tables: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional(),
        context: z.string().optional(),
      })
    ),
  }),
  execute: async (_input, context) => {
    const client = aiDataClient(context);
    const tables = await client.listTables();
    const refs = await listRecords(client, TABLES.tableReferences, { take: 50 }).catch(() => []);
    const contextByName = new Map<string, string>();
    for (const r of refs) {
      const title = r.fields.title;
      const note = r.fields.context;
      if (typeof title === 'string' && typeof note === 'string') {
        contextByName.set(title.toLowerCase(), note);
      }
    }
    return {
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? undefined,
        context: contextByName.get(t.name.toLowerCase()),
      })),
    };
  },
});

// ── describe-table ───────────────────────────────────────────────────────────

export const describeTableTool = createTool({
  id: 'describe-table',
  description:
    'Describe a table: its fields with field IDs, names, types, and primary/computed ' +
    'flags. filter/orderBy on list-records accept field IDs or names. Computed/primary ' +
    'fields are read-only.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX) or name, from discover-tables'),
  }),
  outputSchema: z.object({
    fields: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        isPrimary: z.boolean().optional(),
        isComputed: z.boolean().optional(),
      })
    ),
  }),
  execute: async ({ tableId }, context) => {
    const table = await aiDataClient(context).describeTable(tableId);
    return {
      fields: table.fields.map(({ id, name, type, isPrimary, isComputed }) => ({
        id,
        name,
        type,
        isPrimary,
        isComputed,
      })),
    };
  },
});

// ── list-records ─────────────────────────────────────────────────────────────

export const listRecordsTool = createTool({
  id: 'list-records',
  description:
    'List records from any table of the current base (up to 50 per call; soft-deleted rows ' +
    'are left out). Use `search` for plain keyword matching across fields. Use `filter` ' +
    '(a JSON string whose fieldId keys are field IDs or names from describe-table) for ' +
    'precise matching. Use `orderBy` (same keys) to sort. Cells are keyed by field name.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX) or name, from discover-tables'),
    take: z.number().int().min(1).max(200).optional().default(50),
    skip: z.number().int().min(0).optional(),
    search: z.string().optional().describe('Text search against record fields'),
    filter: z
      .string()
      .optional()
      .describe('JSON filter string; fieldId keys are field IDs or names'),
    orderBy: z
      .string()
      .optional()
      .describe('JSON orderBy string, e.g. [{"fieldId":"title","order":"asc"}]'),
  }),
  outputSchema: listOutput,
  execute: async ({ tableId, take, skip, search, filter, orderBy }, context) => {
    const page = await aiDataClient(context).queryRecords(tableId, {
      take,
      skip,
      search,
      filter: parseJsonArg<AiDataFilter>('filter', filter),
      orderBy: parseJsonArg<{ fieldId: string; order: 'asc' | 'desc' }[]>('orderBy', orderBy),
    });
    return { records: page.records, total: page.returned };
  },
});

// ── get-record ───────────────────────────────────────────────────────────────

export const getRecordTool = createTool({
  id: 'get-record',
  description: 'Fetch a single record by its Teable record id (recXXX) from any table.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX) or name'),
    recordId: z.string().describe('Record id (e.g. recXXX)'),
  }),
  outputSchema: z.object({ record: recordSchema.nullable() }),
  execute: async ({ tableId, recordId }, context) => {
    const [record] = await aiDataClient(context).getRecordsByIds(tableId, [recordId]);
    return { record: record ?? null };
  },
});
