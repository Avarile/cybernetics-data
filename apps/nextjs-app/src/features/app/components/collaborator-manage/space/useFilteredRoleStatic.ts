import type { IRole } from '@cybernetics/core';
import { useMemo } from 'react';
import { useRoleStatic } from '../useRoleStatic';
import { getRolesWithLowerPermissions } from '../utils';

export const useFilteredRoleStatic = (role: IRole) => {
  const spaceRoleStatic = useRoleStatic();
  return useMemo(
    () => getRolesWithLowerPermissions(role, spaceRoleStatic),
    [role, spaceRoleStatic]
  );
};
