import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import {
  schemaPackAddOptionsSchema,
  schemaPackInstallOptionsSchema,
  schemaPackSelectionSchema,
} from './types';

export const INSTALL_SCHEMA_PACKS = '/schema-pack/install';
export const ADD_SCHEMA_PACKS = '/base/{baseId}/schema-pack/install';

export const schemaPackInstallRoSchema = z
  .object({
    spaceId: z.string().startsWith('spc'),
    packs: schemaPackSelectionSchema,
    options: schemaPackInstallOptionsSchema,
    completeOnboarding: z.boolean().optional().meta({
      description: "Mark the user's first-run onboarding as completed",
    }),
  })
  .strict();
export type ISchemaPackInstallRo = z.infer<typeof schemaPackInstallRoSchema>;

export const schemaPackAddRoSchema = z
  .object({
    packs: schemaPackSelectionSchema,
    options: schemaPackAddOptionsSchema,
  })
  .strict();
export type ISchemaPackAddRo = z.infer<typeof schemaPackAddRoSchema>;

export const schemaPackInstallVoSchema = z.object({
  baseId: z.string(),
  tables: z.object({ key: z.string(), id: z.string(), name: z.string() }).array(),
  counts: z.object({
    tables: z.number().int(),
    fields: z.number().int(),
    records: z.number().int(),
  }),
});
export type ISchemaPackInstallVo = z.infer<typeof schemaPackInstallVoSchema>;

const installResponses = {
  201: {
    description: 'The base and the tables that were created.',
    content: { 'application/json': { schema: schemaPackInstallVoSchema } },
  },
};

export const InstallSchemaPacksRoute: RouteConfig = registerRoute({
  method: 'post',
  path: INSTALL_SCHEMA_PACKS,
  description:
    'Build the selected schema packs into a new base; if a step fails, the new base is deleted',
  request: {
    body: { content: { 'application/json': { schema: schemaPackInstallRoSchema } } },
  },
  responses: installResponses,
  tags: ['schema-pack'],
});

export const AddSchemaPacksRoute: RouteConfig = registerRoute({
  method: 'post',
  path: ADD_SCHEMA_PACKS,
  description:
    'Add the selected schema packs to this base; if a step fails, the tables and fields it created are removed',
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: schemaPackAddRoSchema } } },
  },
  responses: installResponses,
  tags: ['schema-pack'],
});

export const installSchemaPacks = async (ro: ISchemaPackInstallRo) => {
  return axios.post<ISchemaPackInstallVo>(INSTALL_SCHEMA_PACKS, ro);
};

export const addSchemaPacks = async (baseId: string, ro: ISchemaPackAddRo) => {
  return axios.post<ISchemaPackInstallVo>(urlBuilder(ADD_SCHEMA_PACKS, { baseId }), ro);
};
