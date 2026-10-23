import { useBasePermission, useThemeMode } from '@cybernetics/sdk/hooks';
import type { IUIConfig } from '@cybernetics/sdk/plugin-bridge';
import { useRouter } from 'next/router';
import { useMemo } from 'react';
import type { IPluginParams } from '../types';

export const useUIConfig = (pluginParams: IPluginParams) => {
  const basePermissions = useBasePermission();
  const themeMode = useThemeMode();
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string;
  const canSetting = basePermissions?.['base|update'];
  const pluginInstallId =
    'pluginInstallId' in pluginParams ? pluginParams.pluginInstallId : undefined;

  return useMemo(() => {
    const uiConfig: IUIConfig = {
      theme: themeMode,
    };
    if (pluginInstallId) {
      uiConfig.isShowingSettings = expandPluginId === pluginInstallId && canSetting;
      uiConfig.isExpand = expandPluginId === pluginInstallId;
    }
    return uiConfig;
  }, [expandPluginId, pluginInstallId, themeMode, canSetting]);
};
