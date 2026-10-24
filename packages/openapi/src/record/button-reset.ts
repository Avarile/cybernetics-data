import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IRecord } from '@cybernetics/core';
import { recordSchema } from '@cybernetics/core';
import type { AxiosResponse } from 'axios';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BUTTON_RESET = '/table/{tableId}/record/{recordId}/{fieldId}/button-reset';

export const ButtonResetRoute: RouteConfig = registerRoute({
  method: 'post',
  path: BUTTON_RESET,
  summary: 'Button reset',
  description: 'Button reset',
  request: {
    params: z.object({
      tableId: z.string(),
      recordId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the reset cell',
      content: {
        'application/json': {
          schema: recordSchema,
        },
      },
    },
  },
  tags: ['record'],
});

export async function buttonReset(
  tableId: string,
  recordId: string,
  fieldId: string
): Promise<AxiosResponse<IRecord>> {
  return axios.post<IRecord>(urlBuilder(BUTTON_RESET, { tableId, recordId, fieldId }));
}
