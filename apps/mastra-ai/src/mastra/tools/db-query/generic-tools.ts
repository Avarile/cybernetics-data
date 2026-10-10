import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  teableList,
  teableGetById,
  teableCreate,
  teableUpdate,
  teableDelete,
} from './teable-client.js';
import { listBaseTables, listTableFields } from './teable-meta.js';
import { listTableReferences } from './table-references.js';

// ── Shared zod shapes (mirror db-query-tools.ts) ─────────────────────────────

const recordSchema = z.object({ id: z.string(), fields: z.record(z.string(), z.unknown()) });
const listOutput = z.object({ records: z.array(recordSchema), total: z.number() });

type GR = { id: string; fields: Record<string, unknown> };
const gr = (r: { id: string; fields: object }) => r as GR;

const errString = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ── discover-tables ──────────────────────────────────────────────────────────

export const discoverTablesTool = createTool({
  id: 'discover-tables',
  description:
    'List every table available in the database, with id, name, description, and any ' +
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
  execute: async () => {
    const [tables, refs] = await Promise.all([
      listBaseTables(),
      listTableReferences().catch(() => ({ records: [] })),
    ]);
    const contextByName = new Map<string, string>();
    for (const r of refs.records) {
      if (r.fields.title && r.fields.context) {
        contextByName.set(r.fields.title.toLowerCase(), r.fields.context);
      }
    }
    return {
      tables: tables.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
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
    'flags. Field IDs are required for filter/orderBy on list-records; field NAMES are ' +
    'used when creating/updating records. Computed/primary fields are read-only for writes.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX) from discover-tables'),
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
  execute: async ({ tableId }) => {
    const fields = await listTableFields(tableId);
    return { fields };
  },
});

// ── list-records ─────────────────────────────────────────────────────────────

export const listRecordsTool = createTool({
  id: 'list-records',
  description:
    'List records from any table. Use `search` for plain keyword matching across fields. ' +
    'Use `filter` (a pre-serialized JSON string whose fieldId keys are real field IDs from ' +
    'describe-table) for precise matching. Use `orderBy` (also field-ID based) to sort.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX) from discover-tables'),
    take: z.number().int().min(1).max(200).optional().default(50),
    skip: z.number().int().min(0).optional(),
    search: z.string().optional().describe('Text search against record fields'),
    filter: z
      .string()
      .optional()
      .describe('Pre-serialized JSON filter string; fieldId keys must be real field IDs'),
    orderBy: z
      .string()
      .optional()
      .describe('Pre-serialized JSON orderBy string; fieldId keys must be real field IDs'),
  }),
  outputSchema: listOutput,
  execute: async ({ tableId, take, skip, search, filter, orderBy }) => {
    const result = await teableList<Record<string, unknown>>(tableId, {
      take,
      skip,
      search,
      filter,
      orderBy,
    });
    return { records: result.records.map(gr), total: result.records.length };
  },
});

// ── get-record ───────────────────────────────────────────────────────────────

export const getRecordTool = createTool({
  id: 'get-record',
  description: 'Fetch a single record by its Teable record id (recXXX) from any table.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX)'),
    recordId: z.string().describe('Record id (e.g. recXXX)'),
  }),
  outputSchema: z.object({ record: recordSchema.nullable() }),
  execute: async ({ tableId, recordId }) => {
    const record = await teableGetById<Record<string, unknown>>(tableId, recordId);
    return { record: record ? gr(record) : null };
  },
});

// ── create-records ───────────────────────────────────────────────────────────
// NOT USED AT THE MOMENT: no agent registers this write tool (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.

export const createRecordsTool = createTool({
  id: 'create-records',
  description:
    'Create one or more records in any table. Each record is a map of field NAME → value ' +
    '(get names from describe-table). Do not set primary/computed (read-only) fields. ' +
    'Link fields take arrays of record ids — resolve them yourself via list-records on the ' +
    'linked table.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX)'),
    records: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe('Array of { fieldName: value } maps'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    records: z.array(recordSchema).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tableId, records }) => {
    try {
      const result = await teableCreate<Record<string, unknown>>(tableId, records);
      return { success: true, records: result.records.map(gr) };
    } catch (err) {
      return { success: false, error: errString(err) };
    }
  },
});

// ── update-record ────────────────────────────────────────────────────────────
// NOT USED AT THE MOMENT: no agent registers this write tool (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.

export const updateRecordTool = createTool({
  id: 'update-record',
  description:
    'Update a single record by id. `fields` is a map of field NAME → new value. Only ' +
    'include fields you want to change; do not set primary/computed (read-only) fields.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX)'),
    recordId: z.string().describe('Record id (e.g. recXXX)'),
    fields: z.record(z.string(), z.unknown()).describe('{ fieldName: value } map'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    record: recordSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tableId, recordId, fields }) => {
    try {
      const result = await teableUpdate<Record<string, unknown>>(tableId, recordId, fields);
      return { success: true, record: gr(result.record) };
    } catch (err) {
      return { success: false, error: errString(err) };
    }
  },
});

// ── delete-record ────────────────────────────────────────────────────────────
// NOT USED AT THE MOMENT: no agent registers this write tool (the Mastra agents are
// read-only). Kept for a future write gateway; see CYBERDATA-12.

export const deleteRecordTool = createTool({
  id: 'delete-record',
  description:
    'Delete a single record by id from any table. Destructive — always confirm with the ' +
    'user (quoting the record title) before calling.',
  inputSchema: z.object({
    tableId: z.string().describe('Table id (e.g. tblXXX)'),
    recordId: z.string().describe('Record id (e.g. recXXX)'),
  }),
  outputSchema: z.object({ success: z.boolean(), error: z.string().optional() }),
  execute: async ({ tableId, recordId }) => {
    try {
      await teableDelete(tableId, recordId);
      return { success: true };
    } catch (err) {
      return { success: false, error: errString(err) };
    }
  },
});
