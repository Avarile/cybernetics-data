import { Logger } from '@nestjs/common';
import { filterSchema } from '@teable/core';
import { orderBySchema } from '@teable/openapi';
import { tool } from 'ai';
import { z } from 'zod';
import { toAiDataErrorMessage } from '../../ai-data/ai-data.limits';
import type { AiDataService, IAiDataQueryArgs } from '../../ai-data/ai-data.service';

/**
 * Read tools for the in-process agents. They call AiDataService, which runs as
 * the chatting user and only sees the request's base. The base id comes from
 * the server (experimental_context), never from the model's arguments.
 */
export interface IDataToolContext {
  aiData: AiDataService;
  baseId: string;
}

const logger = new Logger('AiDataTools');

function getDataContext(context: unknown): IDataToolContext {
  const { aiData, baseId } = (context ?? {}) as Partial<IDataToolContext>;
  if (!aiData || !baseId) {
    throw new Error('Data tools need aiData and baseId in the agent context');
  }
  return { aiData, baseId };
}

/** Errors become tool results the model can read; details go to the log only. */
async function runDataTool<T>(
  name: string,
  context: unknown,
  task: (ctx: IDataToolContext) => Promise<T>
): Promise<T | { error: string }> {
  try {
    return await task(getDataContext(context));
  } catch (error) {
    logger.warn(
      `AI data tool "${name}" failed: ${error instanceof Error ? error.stack : String(error)}`
    );
    return { error: toAiDataErrorMessage(error) };
  }
}

const tableIdInput = z
  .string()
  .describe('Table id from listTables (e.g. tblXXXXXXXX) or the exact table name');
const fieldKeyTypeInput = z
  .enum(['id', 'name'])
  .optional()
  .describe('Key returned cells by field id (default) or by field name');

export const listTablesTool = tool({
  description:
    'List the tables in the current base with their ids, names and descriptions. ' +
    'Call this first to find the table that matches the request.',
  inputSchema: z.object({}),
  execute: async (_args, { experimental_context: context }) =>
    runDataTool('listTables', context, ({ aiData, baseId }) => aiData.listTables(baseId)),
});

export const describeTableTool = tool({
  description:
    'Get the fields of one table: field id (fldXXX), name, type, whether it is the primary ' +
    '(title) field, link targets (linkedTableId) and select choices, plus a profile naming ' +
    'the title, context and soft-delete (deleted_at) fields. Call this before queryRecords ' +
    'so filters, sorting and projection use real field ids or names.',
  inputSchema: z.object({ tableId: tableIdInput }),
  execute: async ({ tableId }, { experimental_context: context }) =>
    runDataTool('describeTable', context, ({ aiData, baseId }) =>
      aiData.describeTable(baseId, tableId)
    ),
});

export const queryRecordsTool = tool({
  description:
    'Read records from a table. Cells are keyed by field id, or by name with ' +
    'fieldKeyType "name". Use `search` for plain-text lookups, or `filter` for precise ' +
    'matching. Soft-deleted rows (deleted_at set) are left out unless includeDeleted is true. ' +
    'Page with take/skip: when hasMore is true, call again with skip = nextSkip. When ' +
    'truncated is true some long cells were cut or records were held back to keep the ' +
    'answer small; say so if it matters.',
  inputSchema: z.object({
    tableId: tableIdInput,
    search: z.string().optional().describe('Plain text matched across the table'),
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Teable filter; fieldId may be a field id or name, e.g. {"conjunction":"and","filterSet":' +
          '[{"fieldId":"fldXXX","operator":"contains","value":"Acme"}]}. Operators include ' +
          'is, isNot, contains, doesNotContain, isGreater, isLess, isEmpty, isNotEmpty.'
      ),
    orderBy: z
      .array(z.object({ fieldId: z.string(), order: z.enum(['asc', 'desc']) }))
      .optional()
      .describe('Sort by field id or name, e.g. [{"fieldId":"fldXXX","order":"desc"}]'),
    projection: z
      .array(z.string())
      .optional()
      .describe('Only return these field ids or names, to keep the answer small'),
    take: z.number().int().min(1).optional().describe('How many records (default 20, capped)'),
    skip: z.number().int().min(0).optional().describe('How many records to skip (default 0)'),
    fieldKeyType: fieldKeyTypeInput,
    includeDeleted: z
      .boolean()
      .optional()
      .describe('Also return soft-deleted rows (deleted_at set). Default false.'),
  }),
  execute: async (args, { experimental_context: context }) =>
    runDataTool('queryRecords', context, ({ aiData, baseId }) => {
      const query: IAiDataQueryArgs = {
        tableId: args.tableId,
        search: args.search,
        projection: args.projection,
        take: args.take,
        skip: args.skip,
        fieldKeyType: args.fieldKeyType,
        includeDeleted: args.includeDeleted,
        // Validate with the same schemas the REST API uses, so a malformed filter
        // comes back as a readable error instead of a failed query.
        filter: args.filter ? filterSchema.parse(args.filter) ?? undefined : undefined,
        orderBy: args.orderBy ? orderBySchema.parse(args.orderBy) : undefined,
      };
      return aiData.queryRecords(baseId, query);
    }),
});

export const getRecordsTool = tool({
  description:
    'Read specific records by id (recXXX) in one call, e.g. the targets of a link field. ' +
    'Ids that do not exist or are not visible are listed in missingIds.',
  inputSchema: z.object({
    tableId: tableIdInput,
    recordIds: z.array(z.string()).min(1).describe('Record ids, e.g. ["recXXX"]'),
    fieldKeyType: fieldKeyTypeInput,
  }),
  execute: async ({ tableId, recordIds, fieldKeyType }, { experimental_context: context }) =>
    runDataTool('getRecords', context, ({ aiData, baseId }) =>
      aiData.getRecords(baseId, tableId, recordIds, { fieldKeyType })
    ),
});

/** The read toolset shared by the general and ingestion agents. */
export const dataTools = {
  listTables: listTablesTool,
  describeTable: describeTableTool,
  queryRecords: queryRecordsTool,
  getRecords: getRecordsTool,
};
