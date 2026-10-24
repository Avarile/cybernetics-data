import { Role, type IRole } from '@cybernetics/core';
import { useMemo } from 'react';
import { useRoleStatic } from '../useRoleStatic';
import { getRolesWithLowerPermissions } from '../utils';

export const useFilteredRoleStatic = (role: IRole) => {
  const baseRoleStatic = useRoleStatic();
  return useMemo(
    () => getRolesWithLowerPermissions(role === Role.Owner ? Role.Creator : role, baseRoleStatic),
    [role, baseRoleStatic]
  );
};
