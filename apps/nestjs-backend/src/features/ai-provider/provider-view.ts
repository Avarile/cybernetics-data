import type {
  IAIConfig,
  IAiProviderVo,
  IProviderHealthStatus,
  IProviderKeySource,
  IProviderUsage,
  LLMProvider,
} from '@teable/openapi';
import { LLMProviderType, providerTypeLabel } from '@teable/openapi';
import { GATEWAY_PROVIDER_ID } from '../setting/provider-secret.service';

/** Types that can be called without a key (local Ollama, self-hosted OpenAI-compatible). */
export const KEYLESS_TYPES: LLMProviderType[] = [
  LLMProviderType.OLLAMA,
  LLMProviderType.OPENAI_COMPATIBLE,
];

export interface IKeyFacts {
  keySource: IProviderKeySource;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  /** Only for env-keyed providers: whether the variable is set. */
  envSet?: boolean;
}

export const countModels = (models: string | undefined) =>
  (models ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean).length;

/** The health chip, decided on the server from config, key facts and the last test. */
export function providerHealth(
  provider: Pick<LLMProvider, 'type' | 'enabled' | 'lastTest' | 'apiKeyEnv'>,
  key: IKeyFacts
): IProviderHealthStatus {
  if (provider.enabled === false) return 'disabled';
  const keyMissing =
    (key.keySource === 'env' && !key.envSet) ||
    (key.keySource === 'none' && !KEYLESS_TYPES.includes(provider.type));
  if (keyMissing) return 'not-set';
  if (provider.lastTest?.ok === false) return 'error';
  if (provider.lastTest?.ok) return 'ready';
  return 'untested';
}

/** A stored provider as the admin API returns it: no key, plus health and usage. */
export function toProviderVo(
  provider: LLMProvider,
  key: IKeyFacts,
  usedBy: IProviderUsage[]
): IAiProviderVo {
  const { apiKey: _apiKey, ...rest } = provider;
  return {
    ...rest,
    id: provider.id!,
    hasApiKey: key.hasApiKey,
    keySource: key.keySource,
    ...(key.apiKeyPreview ? { apiKeyPreview: key.apiKeyPreview } : {}),
    ...(key.envSet !== undefined ? { envSet: key.envSet } : {}),
    status: providerHealth(provider, key),
    ...(provider.lastTest ? { lastTestedAt: provider.lastTest.at } : {}),
    ...(provider.lastTest?.error ? { lastError: provider.lastTest.error } : {}),
    modelCount: countModels(provider.models),
    usedBy,
    version: provider.version ?? 0,
  };
}

/**
 * The Vercel AI Gateway, stored in aiConfig.aiGatewayApiKey / aiGatewayBaseUrl / gatewayModels,
 * presented as one more provider. Its models are managed by the Gateway model pool.
 */
export function gatewayAsProvider(
  aiConfig: IAIConfig | null | undefined,
  gatewayMeta: Pick<LLMProvider, 'version' | 'lastTest'> | undefined
): LLMProvider {
  const models = (aiConfig?.gatewayModels ?? [])
    .filter((m) => m.enabled)
    .map((m) => m.id)
    .join(',');
  return {
    id: GATEWAY_PROVIDER_ID,
    type: LLMProviderType.AI_GATEWAY,
    name: providerTypeLabel(LLMProviderType.AI_GATEWAY),
    apiKey: aiConfig?.aiGatewayApiKey ?? undefined,
    baseUrl: aiConfig?.aiGatewayBaseUrl ?? undefined,
    models,
    isInstance: true,
    version: gatewayMeta?.version ?? 0,
    lastTest: gatewayMeta?.lastTest,
  };
}
