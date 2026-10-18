import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';

export const UPDATE_USER_ONBOARDING = '/user/onboarding';

/** `legacy` is only written by the migration, for users who predate onboarding. */
export const userOnboardingStatusSchema = z.enum(['completed', 'skipped', 'legacy']);
export type UserOnboardingStatus = z.infer<typeof userOnboardingStatusSchema>;

export const updateUserOnboardingRoSchema = z
  .object({
    status: z.enum(['completed', 'skipped']),
  })
  .strict();

export type IUpdateUserOnboardingRo = z.infer<typeof updateUserOnboardingRoSchema>;

export const UpdateUserOnboardingRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPDATE_USER_ONBOARDING,
  description: 'Record that the user finished or skipped first-run onboarding',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateUserOnboardingRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['user'],
});

export const updateUserOnboarding = async (ro: IUpdateUserOnboardingRo) => {
  return axios.patch<void>(UPDATE_USER_ONBOARDING, ro);
};
