import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { emailFolderSchema } from './types';
import type { IEmailFolder } from './types';

export const GET_USER_INTEGRATION_FOLDERS = '/user-integrations/{integrationId}/folders';

export const getUserIntegrationFoldersRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_USER_INTEGRATION_FOLDERS,
  description: 'List the folders (or Gmail labels) of one of your mail integrations',
  request: { params: z.object({ integrationId: z.string() }) },
  responses: {
    200: {
      description: 'Folders',
      content: { 'application/json': { schema: z.array(emailFolderSchema) } },
    },
  },
  tags: ['email'],
});

export const getUserIntegrationFolders = async (integrationId: string) => {
  return await axios.get<IEmailFolder[]>(
    urlBuilder(GET_USER_INTEGRATION_FOLDERS, { integrationId })
  );
};
