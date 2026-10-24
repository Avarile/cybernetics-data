import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { FieldType } from '@cybernetics/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import {
  schemaPackIdSchema,
  schemaPackInstallOptionsSchema,
  schemaPackSelectionSchema,
} from './types';

export const PLAN_SCHEMA_PACK_INSTALL = '/schema-pack/plan';
export const PLAN_SCHEMA_PACK_ADD = '/base/{baseId}/schema-pack/plan';

export const schemaPackPlanRoSchema = z
  .object({
    packs: schemaPackSelectionSchema,
    optionalTables: schemaPackInstallOptionsSchema.shape.optionalTables,
    starterRows: z.boolean().optional(),
  })
  .strict();
export type ISchemaPackPlanRo = z.infer<typeof schemaPackPlanRoSchema>;

export const schemaPackPlanVoSchema = z.object({
  tables: z
    .object({
      key: z.string(),
      name: z.string(),
      pack: schemaPackIdSchema,
      existing: z.boolean().meta({ description: 'Already in the target base; skipped' }),
      fields: z
        .object({
          key: z.string(),
          name: z.string(),
          type: z.enum(FieldType),
          isLookup: z.boolean().optional(),
          bridge: schemaPackIdSchema.optional().meta({
            description: 'The other pack, when this field is a cross-pack bridge',
          }),
        })
        .array(),
    })
    .array(),
  counts: z.object({
    tables: z.number().int(),
    fields: z.number().int(),
    links: z.number().int(),
    seedRows: z.number().int(),
  }),
});
export type ISchemaPackPlanVo = z.infer<typeof schemaPackPlanVoSchema>;

const planResponses = {
  200: {
    description: 'The install plan.',
    content: { 'application/json': { schema: schemaPackPlanVoSchema } },
  },
};

export const PlanSchemaPackInstallRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLAN_SCHEMA_PACK_INSTALL,
  description: 'Preview exactly which tables and fields an install into a new base would create',
  request: {
    body: { content: { 'application/json': { schema: schemaPackPlanRoSchema } } },
  },
  responses: planResponses,
  tags: ['schema-pack'],
});

export const PlanSchemaPackAddRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLAN_SCHEMA_PACK_ADD,
  description: 'Preview exactly which tables and fields adding packs to this base would create',
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: schemaPackPlanRoSchema } } },
  },
  responses: planResponses,
  tags: ['schema-pack'],
});

export const planSchemaPackInstall = async (ro: ISchemaPackPlanRo) => {
  return axios.post<ISchemaPackPlanVo>(PLAN_SCHEMA_PACK_INSTALL, ro);
};

export const planSchemaPackAdd = async (baseId: string, ro: ISchemaPackPlanRo) => {
  return axios.post<ISchemaPackPlanVo>(urlBuilder(PLAN_SCHEMA_PACK_ADD, { baseId }), ro);
};
