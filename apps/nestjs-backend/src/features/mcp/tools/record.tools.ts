import { FieldKeyType, HttpErrorCode } from '@teable/core';
import { z } from 'zod';
import { CustomHttpException } from '../../../custom.exception';
import { defineTool } from '../types';
import type { IMcpTool } from '../types';
import { recordIdSchema, tableIdSchema, viewIdSchema } from './ids';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

const cellsSchema = z
  .record(z.string(), z.unknown())
  .describe('Cell values keyed by FIELD ID (not field name). Get ids from get_table_schema.');

/**
 * Every read pins fieldKeyType to Id. getRecord defaults it to Name
 * internally (record.service.ts:1082), which would make fields[fieldId]
 * silently return undefined.
 */
export const buildRecordTools = (): IMcpTool[] => [
  defineTool({
    name: 'query_records',
    title: 'Query records',
    description:
      'Read records from a table. Returns cells keyed by field id. Use skip/take to page; hasMore tells you whether more remain.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      viewId: viewIdSchema.optional().describe('Apply this view filter, sort and field visibility'),
      take: z.number().int().min(1).optional().describe('How many records to return (default 50)'),
      skip: z.number().int().min(0).optional().describe('How many records to skip (default 0)'),
      search: z.string().optional().describe('Full-text search across the table'),
      projection: z
        .array(z.string())
        .optional()
        .describe('Only return these field ids, to keep the response small'),
    }),
    annotations: readOnly,
    requiredActions: ['record|read'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      const take = Math.min(args.take ?? 50, ctx.config.maxRecordsPerCall);
      const skip = args.skip ?? 0;

      // Over-fetch by one to learn hasMore without a second count query.
      const result = (await ctx.recordService.getRecords(args.tableId, {
        take: take + 1,
        skip,
        viewId: args.viewId,
        // The third element (hideNotMatchRow) is what turns search into a filter;
        // without it the search only highlights and every row comes back.
        search: args.search ? [args.search, undefined, true] : undefined,
        projection: args.projection,
        fieldKeyType: FieldKeyType.Id,
      } as never)) as { records: { id: string; fields: Record<string, unknown> }[] };

      const hasMore = result.records.length > take;
      const records = hasMore ? result.records.slice(0, take) : result.records;

      return {
        records: records.map(({ id, fields }) => ({ id, fields })),
        returned: records.length,
        hasMore,
        nextSkip: hasMore ? skip + take : null,
      };
    },
  }),

  defineTool({
    name: 'get_record',
    title: 'Get one record',
    description: 'Read a single record by id. Returns cells keyed by field id.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      recordId: recordIdSchema,
      projection: z.array(z.string()).optional().describe('Only return these field ids'),
    }),
    annotations: readOnly,
    requiredActions: ['record|read'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      const record = (await ctx.recordService.getRecord(args.tableId, args.recordId, {
        projection: args.projection,
        fieldKeyType: FieldKeyType.Id,
      } as never)) as { id: string; fields: Record<string, unknown> };
      return { id: record.id, fields: record.fields };
    },
  }),

  defineTool({
    name: 'create_records',
    title: 'Create records',
    description:
      'Add records to a table. Cells are keyed by field id — call get_table_schema first. Computed fields cannot be written.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      records: z
        .array(z.object({ fields: cellsSchema }))
        .min(1)
        .describe('The records to create'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    requiredActions: ['record|create'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      if (args.records.length > ctx.config.maxRecordsPerCall) {
        throw new CustomHttpException(
          `Cannot create more than ${ctx.config.maxRecordsPerCall} records in one call`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      const result = (await ctx.recordWriteService.multipleCreateRecords(args.tableId, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: args.records,
      } as never)) as { records: { id: string }[] };
      return { created: result.records.length, recordIds: result.records.map((r) => r.id) };
    },
  }),

  defineTool({
    name: 'update_record',
    title: 'Update a record',
    description:
      'Change cells on one record. Only the field ids you pass are modified; the rest are left alone.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      recordId: recordIdSchema,
      fields: cellsSchema,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    requiredActions: ['record|update'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      const record = (await ctx.recordWriteService.updateRecord(args.tableId, args.recordId, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        record: { fields: args.fields },
      } as never)) as { id: string; fields: Record<string, unknown> };
      return { id: record.id, fields: record.fields };
    },
  }),

  defineTool({
    name: 'delete_records',
    title: 'Delete records',
    description:
      'Delete records by id. Deleted records go to the table trash and can be restored from the table Trash panel in the UI, so this is recoverable — but tell the user what you deleted.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      recordIds: z.array(recordIdSchema).min(1).describe('The record ids to delete'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    requiredActions: ['record|delete'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      // Bounds the blast radius of one call: a runaway loop becomes many
      // visible, individually restorable operations rather than one big one.
      if (args.recordIds.length > ctx.config.maxDeletePerCall) {
        throw new CustomHttpException(
          `Cannot delete more than ${ctx.config.maxDeletePerCall} records in one call; received ${args.recordIds.length}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      await ctx.recordWriteService.deleteRecords(args.tableId, args.recordIds);
      return {
        deleted: args.recordIds.length,
        recoverable: true,
        recoveryHint: 'Restore from the table Trash panel in the UI.',
      };
    },
  }),
];
