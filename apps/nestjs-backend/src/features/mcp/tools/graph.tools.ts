import { z } from 'zod';
import { defineTool } from '../types';
import type { IMcpTool } from '../types';
import { baseIdSchema, recordIdSchema, tableIdSchema, viewIdSchema } from './ids';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const fieldIdSchema = z.string().startsWith('fld').describe('A field id, e.g. fldXXXXXXXX');

/**
 * The base graph, for a model: records as nodes, link-field values as edges.
 * Output is trimmed to what a model reasons with — ids, labels, structure —
 * and never carries layout hints.
 */
export const buildGraphTools = (): IMcpTool[] => [
  defineTool({
    name: 'get_graph',
    title: 'Get the relationship graph',
    description:
      'Records of the given tables as a graph: nodes (id, label, table) and edges from link fields. Use a view to filter; hierarchyFieldId draws a self-link as a tree; groupByFieldId buckets records under a linked record. Node ids are rec:<recordId>.',
    inputSchema: z.object({
      baseId: baseIdSchema,
      tables: z
        .array(
          z.object({
            tableId: tableIdSchema,
            viewId: viewIdSchema.optional(),
            hierarchyFieldId: fieldIdSchema.optional(),
            groupByFieldId: fieldIdSchema.optional(),
            limit: z.number().int().min(1).max(5000).optional(),
          })
        )
        .min(1)
        .max(20),
      linkFieldIds: z
        .array(fieldIdSchema)
        .optional()
        .describe('Only these link fields become edges (default: every link between the tables)'),
    }),
    annotations: readOnly,
    requiredActions: ['record|read'],
    resolveResource: (args) => args.baseId,
    execute: async (args, ctx) => {
      const { baseId, ...ro } = args;
      const { vo } = await ctx.graphService.query(baseId, ro);
      if (!vo) {
        return { nodes: [], edges: [], stats: null };
      }
      return {
        nodes: vo.nodes
          .filter((n) => n.kind !== 'base')
          .map(({ id, kind, label, tableId, parentId }) => ({
            id,
            kind,
            label,
            tableId,
            parentId,
          })),
        edges: vo.links
          .filter((l) => l.kind !== 'hub')
          .map(({ source, target, kind, fieldId }) => ({ source, target, kind, fieldId })),
        stats: vo.stats,
      };
    },
  }),

  defineTool({
    name: 'get_record_neighbors',
    title: 'Get linked records',
    description:
      "A record's directly linked records across every link field (or the ones named), with the link field of each edge.",
    inputSchema: z.object({
      baseId: baseIdSchema,
      tableId: tableIdSchema,
      recordId: recordIdSchema,
      linkFieldIds: z.array(fieldIdSchema).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    annotations: readOnly,
    requiredActions: ['record|read'],
    resolveResource: (args) => args.baseId,
    execute: async (args, ctx) => {
      const { baseId, ...ro } = args;
      const vo = await ctx.graphNodeService.expand(baseId, ro);
      return {
        neighbors: vo.nodes.map(({ id, label, tableId, recordId }) => ({
          id,
          recordId,
          label,
          tableId,
        })),
        edges: vo.links.map(({ source, target, fieldId }) => ({ source, target, fieldId })),
        truncated: vo.truncated,
      };
    },
  }),
];
