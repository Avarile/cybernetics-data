import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { timeZoneStringSchema } from '@cybernetics/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { emailSourceConfigSchema } from './types';

export const CREATE_EMAIL_TABLE = '/base/{baseId}/email/tables';

export const createEmailTableRoSchema = emailSourceConfigSchema.extend({
  integrationId: z.string(),
  name: z.string().trim().min(1).max(100).optional(),
  timeZone: timeZoneStringSchema.optional().describe('For the date fields; defaults to UTC'),
});

export type ICreateEmailTableRo = z.infer<typeof createEmailTableRoSchema>;

export const createEmailTableVoSchema = z.object({
  sourceId: z.string(),
  tableId: z.string(),
  defaultViewId: z.string(),
});

export type ICreateEmailTableVo = z.infer<typeof createEmailTableVoSchema>;

export const createEmailTableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CREATE_EMAIL_TABLE,
  description:
    'Create a table with the email schema, bound to one of your mail integrations, and start importing',
  request: {
    params: z.object({ baseId: z.string() }),
    body: { content: { 'application/json': { schema: createEmailTableRoSchema } } },
  },
  responses: {
    201: {
      description: 'Created',
      content: { 'application/json': { schema: createEmailTableVoSchema } },
    },
  },
  tags: ['email'],
});

export const createEmailTable = async (baseId: string, ro: ICreateEmailTableRo) => {
  return await axios.post<ICreateEmailTableVo>(urlBuilder(CREATE_EMAIL_TABLE, { baseId }), ro);
};
