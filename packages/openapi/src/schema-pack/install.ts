import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import { schemaPackInstallOptionsSchema, schemaPackSelectionSchema } from './types';

export const INSTALL_SCHEMA_PACKS = '/schema-pack/install';

export const schemaPackInstallRoSchema = z
  .object({
    spaceId: z.string().startsWith('spc'),
    packs: schemaPackSelectionSchema,
    options: schemaPackInstallOptionsSchema,
    baseId: z.string().startsWith('bse').optional().meta({
      description: 'Add the packs to this existing base instead of creating one',
    }),
    completeOnboarding: z.boolean().optional().meta({
      description: "Mark the user's first-run onboarding as completed",
    }),
  })
  .strict();
export type ISchemaPackInstallRo = z.infer<typeof schemaPackInstallRoSchema>;

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

export const InstallSchemaPacksRoute: RouteConfig = registerRoute({
  method: 'post',
  path: INSTALL_SCHEMA_PACKS,
  description: 'Build the selected schema packs into a new or existing base, atomically',
  request: {
    body: { content: { 'application/json': { schema: schemaPackInstallRoSchema } } },
  },
  responses: {
    201: {
      description: 'The base and the tables that were created.',
      content: { 'application/json': { schema: schemaPackInstallVoSchema } },
    },
  },
  tags: ['schema-pack'],
});

export const installSchemaPacks = async (ro: ISchemaPackInstallRo) => {
  return axios.post<ISchemaPackInstallVo>(INSTALL_SCHEMA_PACKS, ro);
};
