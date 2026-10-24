import { createFieldRoSchema, HttpErrorCode, viewRoSchema } from '@cybernetics/core';
import { tableRoSchema } from '@teable/openapi';
import { z } from 'zod';
import { CustomHttpException } from '../../../custom.exception';
import { prepareCreateTableRo } from '../../table/open-api/table.pipe.helper';
import { defineTool } from '../types';
import type { IMcpTool } from '../types';
import { baseIdSchema, tableIdSchema, viewIdSchema } from './ids';

const fieldRoSchema = z.object({
  name: z.string().describe('Field name'),
  type: z
    .string()
    .describe(
      'Field type, e.g. singleLineText, longText, number, singleSelect, multipleSelect, date, checkbox, user, rating'
    ),
  description: z.string().optional(),
  options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Type-specific options, e.g. choices for singleSelect'),
});

/**
 * Additive only. delete_field, delete_table and update_field/convertField are
 * deliberately absent — they are irreversible, unlike every tool here, and
 * their exclusion is asserted in the test suite so they cannot be
 * reintroduced without revisiting that decision.
 */
export const buildSchemaTools = (): IMcpTool[] => [
  defineTool({
    name: 'create_table',
    title: 'Create a table',
    description:
      'Create a table in a base. If you pass no fields, a default set is created. The first field becomes the primary field. Note: a new table also starts with a few empty placeholder records, so query_records will not return zero rows.',
    inputSchema: z.object({
      baseId: baseIdSchema,
      name: z.string().describe('Table name'),
      description: z.string().optional(),
      fields: z.array(fieldRoSchema).optional().describe('Initial fields; omit for defaults'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    requiredActions: ['table|create'],
    resolveResource: (args) => args.baseId,
    execute: async (args, ctx) => {
      // createTable expects a pipe-processed RO (table-open-api.controller.ts:154
      // applies TablePipe); prepareCreateTableRo is that transform.
      // The REST path validates with tableRoSchema before TablePipe
      // (table-open-api.controller.ts:154); MCP must not be the lax door in.
      const validated = tableRoSchema.parse({
        name: args.name,
        description: args.description,
        fields: args.fields,
      });
      const prepared = prepareCreateTableRo(validated);
      const table = (await ctx.tableService.createTable(args.baseId, prepared as never)) as {
        id: string;
        name: string;
      };
      return { id: table.id, name: table.name, baseId: args.baseId };
    },
  }),

  defineTool({
    name: 'update_table',
    title: 'Update table metadata',
    description:
      'Rename a table or change its description or icon. This only touches metadata — it never alters fields or records.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      icon: z.string().optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    requiredActions: ['table|update'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      if (args.name === undefined && args.description === undefined && args.icon === undefined) {
        throw new CustomHttpException(
          'Pass at least one of name, description or icon',
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      const baseId = await ctx.resolveBaseId(args.tableId);
      if (args.name !== undefined) {
        await ctx.tableService.updateName(baseId, args.tableId, args.name);
      }
      if (args.description !== undefined) {
        await ctx.tableService.updateDescription(baseId, args.tableId, args.description);
      }
      if (args.icon !== undefined) {
        await ctx.tableService.updateIcon(baseId, args.tableId, args.icon);
      }
      return { id: args.tableId, updated: true };
    },
  }),

  defineTool({
    name: 'create_field',
    title: 'Create a field',
    description:
      'Add a field to a table. Fields cannot be deleted or converted through MCP, so choose the type carefully.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      ...fieldRoSchema.shape,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    requiredActions: ['field|create'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      const { tableId, ...rest } = args;
      // Same schema the REST path uses (field-open-api.controller.ts:124).
      const fieldRo = createFieldRoSchema.parse(rest);
      const field = (await ctx.fieldService.createField(tableId, fieldRo as never)) as {
        id: string;
        name: string;
        type: string;
      };
      return { id: field.id, name: field.name, type: field.type, tableId };
    },
  }),

  defineTool({
    name: 'create_view',
    title: 'Create a view',
    description: 'Add a view to a table, e.g. a grid or kanban view.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      name: z.string().describe('View name'),
      type: z
        .string()
        .describe('View type, e.g. grid, kanban, gallery, form, calendar')
        .default('grid'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    requiredActions: ['view|create'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      // Same schema the REST path uses (view-open-api.controller.ts:103).
      // Without it an arbitrary string was accepted as a view type.
      const viewRo = viewRoSchema.parse({ name: args.name, type: args.type });
      const view = (await ctx.viewWriteService.createView(args.tableId, viewRo as never)) as {
        id: string;
        name: string;
        type: string;
      };
      return { id: view.id, name: view.name, type: view.type, tableId: args.tableId };
    },
  }),

  defineTool({
    name: 'delete_view',
    title: 'Delete a view',
    description:
      'Delete a view. The underlying records are untouched, and the view goes to the table trash so it can be restored from the UI.',
    inputSchema: z.object({
      tableId: tableIdSchema,
      viewId: viewIdSchema,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    requiredActions: ['view|delete'],
    resolveResource: (args) => args.tableId,
    execute: async (args, ctx) => {
      await ctx.viewWriteService.deleteView(args.tableId, args.viewId);
      return {
        deleted: args.viewId,
        recoverable: true,
        recoveryHint: 'Restore from the table Trash panel in the UI.',
      };
    },
  }),
];
