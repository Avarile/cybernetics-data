import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IUserMeVo } from './user-me';
import { userMeVoSchema } from './user-me';

export const SIGN_IN_TWO_FACTOR = '/auth/signin/two-factor';
export const SIGN_IN_TWO_FACTOR_RESEND = '/auth/signin/two-factor/resend';

/**
 * Returned as the `data` of a `two_factor_required` error from sign in,
 * and by the resend endpoint.
 */
export const twoFactorChallengeSchema = z.object({
  challengeId: z.string(),
  maskedEmail: z.string(),
  expiresTime: z.string(),
});

export type ITwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;

export const signinTwoFactorRoSchema = z.object({
  challengeId: z.string(),
  code: z.string(),
});

export type ISigninTwoFactorRo = z.infer<typeof signinTwoFactorRoSchema>;

export const signinTwoFactorResendRoSchema = z.object({
  challengeId: z.string(),
});

export type ISigninTwoFactorResendRo = z.infer<typeof signinTwoFactorResendRoSchema>;

export const SigninTwoFactorRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGN_IN_TWO_FACTOR,
  description: 'Complete a sign in that requires a two-factor code',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signinTwoFactorRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Sign in successfully',
      content: {
        'application/json': {
          schema: userMeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const SigninTwoFactorResendRoute: RouteConfig = registerRoute({
  method: 'post',
  path: SIGN_IN_TWO_FACTOR_RESEND,
  description: 'Send a new two-factor sign in code; returns a new challenge',
  request: {
    body: {
      content: {
        'application/json': {
          schema: signinTwoFactorResendRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Code sent',
      content: {
        'application/json': {
          schema: twoFactorChallengeSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const signinTwoFactor = async (ro: ISigninTwoFactorRo) => {
  return axios.post<IUserMeVo>(SIGN_IN_TWO_FACTOR, ro);
};

export const resendSigninTwoFactor = async (ro: ISigninTwoFactorResendRo) => {
  return axios.post<ITwoFactorChallenge>(SIGN_IN_TWO_FACTOR_RESEND, ro);
};
