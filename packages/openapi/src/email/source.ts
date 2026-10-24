import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { emailSourceConfigSchema, emailSourceVoSchema } from './types';
import type { IEmailSourceVo } from './types';

export const GET_EMAIL_SOURCE_LIST = '/base/{baseId}/email/sources';

export const UPDATE_EMAIL_SOURCE = '/base/{baseId}/email/sources/{sourceId}';

export const SYNC_EMAIL_SOURCE = '/base/{baseId}/email/sources/{sourceId}/sync';

export const getEmailSourceListRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_EMAIL_SOURCE_LIST,
  description: 'List the email tables in a base and their sync state',
  request: { params: z.object({ baseId: z.string() }) },
  responses: {
    200: {
      description: 'Email sources',
      content: { 'application/json': { schema: z.array(emailSourceVoSchema) } },
    },
  },
  tags: ['email'],
});

export const getEmailSourceList = async (baseId: string) => {
  return await axios.get<IEmailSourceVo[]>(urlBuilder(GET_EMAIL_SOURCE_LIST, { baseId }));
};

export const updateEmailSourceRoSchema = emailSourceConfigSchema
  .omit({ since: true, maxMessages: true })
  .partial()
  .extend({
    paused: z.boolean().optional(),
  });

export type IUpdateEmailSourceRo = z.infer<typeof updateEmailSourceRoSchema>;

export const updateEmailSourceRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_EMAIL_SOURCE,
  description:
    'Change how an email table syncs. Only the mailbox owner can change the folders; changes apply to new mail.',
  request: {
    params: z.object({ baseId: z.string(), sourceId: z.string() }),
    body: { content: { 'application/json': { schema: updateEmailSourceRoSchema } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: emailSourceVoSchema } },
    },
  },
  tags: ['email'],
});

export const updateEmailSource = async (
  baseId: string,
  sourceId: string,
  ro: IUpdateEmailSourceRo
) => {
  return await axios.patch<IEmailSourceVo>(
    urlBuilder(UPDATE_EMAIL_SOURCE, { baseId, sourceId }),
    ro
  );
};

export const syncEmailSourceRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SYNC_EMAIL_SOURCE,
  description: 'Start syncing an email table now',
  request: { params: z.object({ baseId: z.string(), sourceId: z.string() }) },
  responses: { 202: { description: 'Sync queued' } },
  tags: ['email'],
});

export const syncEmailSource = async (baseId: string, sourceId: string) => {
  return await axios.post<void>(urlBuilder(SYNC_EMAIL_SOURCE, { baseId, sourceId }));
};
