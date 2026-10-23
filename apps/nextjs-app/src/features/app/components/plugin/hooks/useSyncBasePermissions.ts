import { useBasePermission } from '@cybernetics/sdk/hooks';
import type { IChildBridgeMethods } from '@cybernetics/sdk/plugin-bridge';
import { useEffect } from 'react';

export const useSyncBasePermissions = (bridge?: IChildBridgeMethods) => {
  const basePermissions = useBasePermission();
  useEffect(() => {
    if (!basePermissions) {
      return;
    }
    bridge?.syncBasePermissions(basePermissions);
  }, [basePermissions, bridge]);
};
