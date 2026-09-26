import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { baseGraphLinkSchema, baseGraphNodeSchema } from './types';

export const EXPAND_BASE_GRAPH = '/base/{baseId}/graph/expand';

export const BASE_GRAPH_MAX_EXPAND = 500;

export const baseGraphExpandRoSchema = z.object({
  tableId: z.string().startsWith('tbl'),
  recordId: z.string().startsWith('rec'),
  linkFieldIds: z.string().startsWith('fld').array().optional(),
  limit: z.number().int().min(1).max(BASE_GRAPH_MAX_EXPAND).optional(),
  exclude: z.string().array().max(50000).optional().meta({
    description: 'Node ids the client already has; they are linked to but not re-emitted.',
  }),
});
export type IBaseGraphExpandRo = z.infer<typeof baseGraphExpandRoSchema>;

export const baseGraphExpandVoSchema = z.object({
  nodes: baseGraphNodeSchema.array(),
  links: baseGraphLinkSchema.array(),
  truncated: z.boolean(),
});
export type IBaseGraphExpandVo = z.infer<typeof baseGraphExpandVoSchema>;

export const ExpandBaseGraphRoute: RouteConfig = registerRoute({
  method: 'post',
  path: EXPAND_BASE_GRAPH,
  description: "Load a record's linked neighbours for incremental graph exploration",
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: baseGraphExpandRoSchema } } },
  },
  responses: {
    200: {
      description: 'Neighbour nodes and the links to them.',
      content: { 'application/json': { schema: baseGraphExpandVoSchema } },
    },
  },
  tags: ['base-graph'],
});

export const expandBaseGraph = async (baseId: string, ro: IBaseGraphExpandRo) => {
  return axios.post<IBaseGraphExpandVo>(urlBuilder(EXPAND_BASE_GRAPH, { baseId }), ro);
};
