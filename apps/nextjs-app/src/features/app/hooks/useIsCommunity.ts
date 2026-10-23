import { useIsReadOnlyPreview } from '@cybernetics/sdk/hooks';
import { useEnv } from './useEnv';

export const useIsCommunity = () => {
  const { edition } = useEnv();
  const isReadOnlyPreview = useIsReadOnlyPreview();

  // In template/share preview mode, allow all features to be displayed
  // (similar to how template preview works)
  if (isReadOnlyPreview) {
    return false;
  }

  // Self-hosted instances are not treated as community — only pure Community builds are
  return false;
};
