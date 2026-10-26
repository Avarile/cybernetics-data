import type { ISettingVo } from '@teable/openapi';

type IAiConfigVo = ISettingVo['aiConfig'];

/**
 * The admin API never returns stored keys, only a preview. These helpers answer "is a key stored?"
 * from either field, so the UI works with masked settings.
 */
export const hasStoredGatewayKey = (aiConfig: IAiConfigVo | undefined) =>
  Boolean(aiConfig?.aiGatewayApiKey || aiConfig?.aiGatewayApiKeyPreview);

export const storedKeyPreview = (provider: { apiKeyPreview?: string } | undefined) =>
  provider?.apiKeyPreview;

export const hasStoredProviderKey = (provider: { hasApiKey?: boolean } | undefined) =>
  Boolean(provider?.hasApiKey);
