import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { FieldType, Relationship } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_BASE_GRAPH_SCHEMA = '/base/{baseId}/graph/schema';

export const baseGraphLinkFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  foreignTableId: z.string(),
  relationship: z.enum(Relationship),
  isOneWay: z.boolean(),
  symmetricFieldId: z.string().nullable(),
  isSelfLink: z.boolean(),
  isMultipleCellValue: z.boolean(),
  isCrossBase: z.boolean(),
});
export type IBaseGraphLinkField = z.infer<typeof baseGraphLinkFieldSchema>;

export const baseGraphSchemaTableSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  primaryFieldId: z.string(),
  primaryFieldName: z.string(),
  approxRecordCount: z.number().int().nullable().meta({
    description: 'Planner estimate; null when the table has never been analysed.',
  }),
  views: z.object({ id: z.string(), name: z.string() }).array(),
  fields: z
    .object({ id: z.string(), name: z.string(), type: z.enum(FieldType), isComputed: z.boolean() })
    .array()
    .meta({ description: 'Every field, for presets and filters. Link detail is in linkFields.' }),
  linkFields: baseGraphLinkFieldSchema.array(),
  suggestedHierarchyFieldId: z.string().nullable().meta({
    description: 'The only single-valued self-link on the table, if there is exactly one.',
  }),
});
export type IBaseGraphSchemaTable = z.infer<typeof baseGraphSchemaTableSchema>;

export const baseGraphSchemaVoSchema = z.object({
  baseId: z.string(),
  tables: baseGraphSchemaTableSchema.array(),
});
export type IBaseGraphSchemaVo = z.infer<typeof baseGraphSchemaVoSchema>;

export const GetBaseGraphSchemaRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_BASE_GRAPH_SCHEMA,
  description: 'List the tables and link fields of a base that can be drawn as a graph',
  request: { params: z.object({ baseId: z.string() }) },
  responses: {
    200: {
      description: 'Graphable tables and their link fields.',
      content: { 'application/json': { schema: baseGraphSchemaVoSchema } },
    },
  },
  tags: ['base-graph'],
});

export const getBaseGraphSchema = async (baseId: string) => {
  return axios.get<IBaseGraphSchemaVo>(urlBuilder(GET_BASE_GRAPH_SCHEMA, { baseId }));
};
