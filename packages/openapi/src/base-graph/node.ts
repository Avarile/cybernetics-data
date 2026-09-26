import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { FieldType } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE_GRAPH_NODE = '/base/{baseId}/graph/node/{recordId}';

export const getBaseGraphNodeQuerySchema = z.object({
  tableId: z.string().startsWith('tbl'),
  hierarchyFieldId: z.string().startsWith('fld').optional(),
});
export type IGetBaseGraphNodeQuery = z.infer<typeof getBaseGraphNodeQuerySchema>;

export const baseGraphNodeVoSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  tableId: z.string(),
  tableName: z.string(),
  label: z.string(),
  fields: z
    .object({
      fieldId: z.string(),
      name: z.string(),
      type: z.enum(FieldType),
      cellValue: z.unknown(),
    })
    .array()
    .meta({ description: 'Primary first, then visible fields in view order; capped.' }),
  linkCounts: z
    .object({
      fieldId: z.string(),
      name: z.string(),
      foreignTableId: z.string(),
      count: z.number().int(),
    })
    .array(),
  ancestors: z.object({ id: z.string(), label: z.string() }).array().meta({
    description: 'Root-first breadcrumb along the hierarchy field, excluding this node.',
  }),
  createdTime: z.string().nullable(),
  lastModifiedTime: z.string().nullable(),
});
export type IBaseGraphNodeVo = z.infer<typeof baseGraphNodeVoSchema>;

export const GetBaseGraphNodeRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_GRAPH_NODE,
  description: 'Get the detail of one record in the base graph',
  request: {
    params: z.object({ baseId: z.string(), recordId: z.string() }),
    query: getBaseGraphNodeQuerySchema,
  },
  responses: {
    200: {
      description: 'The record behind the node.',
      content: { 'application/json': { schema: baseGraphNodeVoSchema } },
    },
  },
  tags: ['base-graph'],
});

export const getBaseGraphNode = async (
  baseId: string,
  recordId: string,
  query: IGetBaseGraphNodeQuery
) => {
  return axios.get<IBaseGraphNodeVo>(urlBuilder(GET_BASE_GRAPH_NODE, { baseId, recordId }), {
    params: query,
  });
};
