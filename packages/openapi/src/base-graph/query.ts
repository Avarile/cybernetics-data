import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { filterSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseGraphLinkSchema, baseGraphNodeSchema, baseGraphStatsSchema } from './types';

export const QUERY_BASE_GRAPH = '/base/{baseId}/graph/query';

/** Server-side ceilings for client-supplied budgets. Config may lower them. */
export const BASE_GRAPH_MAX_TABLES = 50;
export const BASE_GRAPH_MAX_TABLE_LIMIT = 20000;

export const baseGraphTableQuerySchema = z.object({
  tableId: z.string().startsWith('tbl'),
  viewId: z
    .string()
    .startsWith('viw')
    .optional()
    .meta({ description: "Apply this view's filter and sort." }),
  filter: filterSchema.optional().meta({ description: "ANDed with the view's filter." }),
  limit: z.number().int().min(1).max(BASE_GRAPH_MAX_TABLE_LIMIT).optional(),
  hierarchyFieldId: z
    .string()
    .startsWith('fld')
    .optional()
    .meta({ description: 'A single-valued self-link: draws the table as a tree.' }),
  groupByFieldId: z
    .string()
    .startsWith('fld')
    .optional()
    .meta({ description: 'A single-valued link to another table: buckets root records.' }),
});
export type IBaseGraphTableQuery = z.infer<typeof baseGraphTableQuerySchema>;

export const baseGraphQueryRoSchema = z
  .object({
    tables: baseGraphTableQuerySchema.array().min(1).max(BASE_GRAPH_MAX_TABLES),
    linkFieldIds: z.string().startsWith('fld').array().optional().meta({
      description: 'Link fields drawn as edges. Omitted = every link between included tables.',
    }),
    showTableHubs: z.boolean().optional(),
    showBaseHub: z.boolean().optional(),
    maxNodes: z.number().int().min(1).optional(),
    maxLinks: z.number().int().min(1).optional(),
  })
  .refine((ro) => new Set(ro.tables.map((t) => t.tableId)).size === ro.tables.length, {
    message: 'Each table may appear only once',
    path: ['tables'],
  });
export type IBaseGraphQueryRo = z.infer<typeof baseGraphQueryRoSchema>;

export const baseGraphVoSchema = z.object({
  version: z.number().int(),
  etag: z.string(),
  nodes: baseGraphNodeSchema.array(),
  links: baseGraphLinkSchema.array(),
  stats: baseGraphStatsSchema,
});
export type IBaseGraphVo = z.infer<typeof baseGraphVoSchema>;

export const QueryBaseGraphRoute: RouteConfig = registerRoute({
  method: 'post',
  path: QUERY_BASE_GRAPH,
  description: 'Assemble a graph of records across the selected tables of a base',
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: baseGraphQueryRoSchema } } },
  },
  responses: {
    200: {
      description: 'The assembled graph.',
      content: { 'application/json': { schema: baseGraphVoSchema } },
    },
  },
  tags: ['base-graph'],
});

export const queryBaseGraph = async (baseId: string, ro: IBaseGraphQueryRo) => {
  return axios.post<IBaseGraphVo>(urlBuilder(QUERY_BASE_GRAPH, { baseId }), ro);
};
