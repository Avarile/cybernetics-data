import type { IRole } from '@cybernetics/core';
import { ReactQueryKeys } from '@cybernetics/sdk/config';
import type { QueryClient } from '@tanstack/react-query';
import type { IGetSpaceVo } from '@teable/openapi';
import { ForbiddenError } from './withAuthSSR';

export const spaceRoleChecker = ({
  queryClient,
  spaceId,
  roles,
}: {
  queryClient: QueryClient;
  spaceId: string;
  roles: IRole[];
}) => {
  const role = (queryClient.getQueryState(ReactQueryKeys.space(spaceId))?.data as IGetSpaceVo)
    ?.role;

  if (!roles.includes(role)) {
    throw new ForbiddenError();
  }
};
