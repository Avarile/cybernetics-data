import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const TWO_FACTOR_EMAIL_SEND_CODE = '/auth/two-factor/email/send-code';
export const TWO_FACTOR_EMAIL_ENABLE = '/auth/two-factor/email/enable';
export const TWO_FACTOR_EMAIL_DISABLE = '/auth/two-factor/email/disable';

export const twoFactorEmailSendCodeRoSchema = z.object({
  action: z.enum(['enable', 'disable']),
  password: z.string(),
});

export type ITwoFactorEmailSendCodeRo = z.infer<typeof twoFactorEmailSendCodeRoSchema>;

export const twoFactorEmailSendCodeVoSchema = z.object({
  token: z.string(),
  expiresTime: z.string(),
});

export type ITwoFactorEmailSendCodeVo = z.infer<typeof twoFactorEmailSendCodeVoSchema>;

export const twoFactorEmailConfirmRoSchema = z.object({
  token: z.string(),
  code: z.string(),
});

export type ITwoFactorEmailConfirmRo = z.infer<typeof twoFactorEmailConfirmRoSchema>;

export const TwoFactorEmailSendCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TWO_FACTOR_EMAIL_SEND_CODE,
  description:
    'Send a code to the current email to enable or disable email two-factor authentication',
  request: {
    body: {
      content: {
        'application/json': {
          schema: twoFactorEmailSendCodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Code sent',
      content: {
        'application/json': {
          schema: twoFactorEmailSendCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const TwoFactorEmailEnableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TWO_FACTOR_EMAIL_ENABLE,
  description: 'Enable email two-factor authentication',
  request: {
    body: {
      content: {
        'application/json': {
          schema: twoFactorEmailConfirmRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Email two-factor authentication enabled',
    },
  },
  tags: ['auth'],
});

export const TwoFactorEmailDisableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TWO_FACTOR_EMAIL_DISABLE,
  description: 'Disable email two-factor authentication',
  request: {
    body: {
      content: {
        'application/json': {
          schema: twoFactorEmailConfirmRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Email two-factor authentication disabled',
    },
  },
  tags: ['auth'],
});

export const sendTwoFactorEmailCode = async (ro: ITwoFactorEmailSendCodeRo) => {
  return axios.post<ITwoFactorEmailSendCodeVo>(TWO_FACTOR_EMAIL_SEND_CODE, ro);
};

export const enableTwoFactorEmail = async (ro: ITwoFactorEmailConfirmRo) => {
  return axios.post<void>(TWO_FACTOR_EMAIL_ENABLE, ro);
};

export const disableTwoFactorEmail = async (ro: ITwoFactorEmailConfirmRo) => {
  return axios.post<void>(TWO_FACTOR_EMAIL_DISABLE, ro);
};
