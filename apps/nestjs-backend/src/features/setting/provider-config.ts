import type { IAIConfig, LLMProvider } from '@teable/openapi';
import { isProviderIdAllowed, suggestProviderId } from '@teable/openapi';

/**
 * Pure transforms over the stored aiConfig: give providers ids, encrypt their keys, merge an
 * incoming config with the stored one without losing keys, and mask keys for the admin API.
 * The caller supplies encryption (ProviderSecretService) so these stay unit-testable.
 */

export interface IKeyCrypto {
  encrypt(providerId: string, plain: string): string;
  isEncrypted(value: unknown): boolean;
}

export interface IKeyPreview {
  preview(provider: LLMProvider): string | undefined;
  gatewayPreview(aiConfig: IAIConfig): string | undefined;
}

/** Provider fields the admin API adds in place of the key. */
export interface IMaskedProviderFields {
  hasApiKey: boolean;
  apiKeyPreview?: string;
}

const uniqueId = (base: string, taken: Set<string>) => {
  const root = isProviderIdAllowed(base) ? base : suggestProviderId(base);
  let id = root;
  for (let n = 2; taken.has(id); n++) id = `${root}-${n}`.slice(0, 48);
  taken.add(id);
  return id;
};

/** Give every provider a stable, unique id; existing valid ids are kept. */
export function assignProviderIds(providers: LLMProvider[]): {
  providers: LLMProvider[];
  changed: boolean;
} {
  const taken = new Set<string>();
  let changed = false;
  const kept = providers.map((p) => {
    if (p.id && isProviderIdAllowed(p.id) && !taken.has(p.id)) {
      taken.add(p.id);
      return p;
    }
    return undefined;
  });
  const out = providers.map((p, i) => {
    if (kept[i]) return p;
    changed = true;
    return { ...p, id: uniqueId(p.type.toLowerCase(), taken) };
  });
  return { providers: out, changed };
}

/**
 * One-off, idempotent migration of a stored aiConfig: ids for every provider, every plain key
 * (providers and the Gateway key) encrypted.
 */
export function migrateAiConfig(
  aiConfig: IAIConfig,
  crypto: IKeyCrypto,
  gatewayProviderId: string
): { aiConfig: IAIConfig; changed: boolean } {
  const withIds = assignProviderIds(aiConfig.llmProviders ?? []);
  let changed = withIds.changed;
  const llmProviders = withIds.providers.map((p) => {
    if (!p.apiKey || crypto.isEncrypted(p.apiKey)) return p;
    changed = true;
    return { ...p, apiKey: crypto.encrypt(p.id!, p.apiKey) };
  });
  let aiGatewayApiKey = aiConfig.aiGatewayApiKey;
  if (aiGatewayApiKey && !crypto.isEncrypted(aiGatewayApiKey)) {
    aiGatewayApiKey = crypto.encrypt(gatewayProviderId, aiGatewayApiKey);
    changed = true;
  }
  return { aiConfig: { ...aiConfig, llmProviders, aiGatewayApiKey }, changed };
}

/** Find the stored provider an incoming one updates: by id, else (pre-id UI) by type + base URL. */
const findStored = (stored: LLMProvider[], incoming: LLMProvider) =>
  (incoming.id && stored.find((s) => s.id === incoming.id)) ||
  stored.find(
    (s) =>
      !incoming.id && s.type === incoming.type && (s.baseUrl ?? '') === (incoming.baseUrl ?? '')
  );

/**
 * Merge a config the admin UI sends with the stored one. The UI never has the keys, so a provider
 * sent without a key (missing or empty) keeps its stored key; a new key is encrypted. The Gateway
 * key is kept when missing and removed only when sent as null.
 */
export function mergeIncomingAiConfig(
  stored: IAIConfig | undefined | null,
  incoming: IAIConfig,
  crypto: IKeyCrypto,
  gatewayProviderId: string
): IAIConfig {
  const storedProviders = stored?.llmProviders ?? [];
  const incomingProviders = (incoming.llmProviders ?? []).map((p) => {
    const {
      hasApiKey: _h,
      apiKeyPreview: _p,
      ...rest
    } = p as LLMProvider & Partial<IMaskedProviderFields>;
    const match = findStored(storedProviders, rest);
    return { ...rest, id: rest.id ?? match?.id, apiKey: rest.apiKey || match?.apiKey };
  });
  const { providers } = assignProviderIds(incomingProviders);
  const llmProviders = providers.map((p) =>
    p.apiKey && !crypto.isEncrypted(p.apiKey)
      ? { ...p, apiKey: crypto.encrypt(p.id!, p.apiKey) }
      : p
  );

  const { aiGatewayApiKeyPreview: _g, ...incomingRest } = incoming as IAIConfig & {
    aiGatewayApiKeyPreview?: string;
  };
  let aiGatewayApiKey: string | null | undefined;
  if (incoming.aiGatewayApiKey === null) {
    aiGatewayApiKey = null;
  } else if (incoming.aiGatewayApiKey) {
    aiGatewayApiKey = crypto.isEncrypted(incoming.aiGatewayApiKey)
      ? stored?.aiGatewayApiKey
      : crypto.encrypt(gatewayProviderId, incoming.aiGatewayApiKey);
  } else {
    aiGatewayApiKey = stored?.aiGatewayApiKey;
  }

  // Masked on read (see maskAiConfig), so a config sent without them keeps the stored values.
  const aiGatewayApiKeys = incoming.aiGatewayApiKeys ?? stored?.aiGatewayApiKeys;
  const vertexByokCredential = incoming.vertexByokCredential ?? stored?.vertexByokCredential;

  return {
    ...incomingRest,
    llmProviders,
    aiGatewayApiKey,
    ...(aiGatewayApiKeys ? { aiGatewayApiKeys } : {}),
    ...(vertexByokCredential ? { vertexByokCredential } : {}),
  };
}

/** The aiConfig as the admin API returns it: no keys, only whether there is one and a preview. */
export function maskAiConfig(aiConfig: IAIConfig, previewer: IKeyPreview) {
  const llmProviders = (aiConfig.llmProviders ?? []).map((p) => {
    const { apiKey, ...rest } = p;
    const masked: IMaskedProviderFields = { hasApiKey: Boolean(apiKey) };
    const preview = apiKey ? previewer.preview(p) : undefined;
    if (preview) masked.apiKeyPreview = preview;
    return { ...rest, ...masked };
  });
  const { aiGatewayApiKey, aiGatewayApiKeys, vertexByokCredential, ...rest } = aiConfig;
  return {
    ...rest,
    llmProviders,
    ...(aiGatewayApiKey ? { aiGatewayApiKeyPreview: previewer.gatewayPreview(aiConfig) } : {}),
    // Key-rotation lists and the Vertex credential are secrets too; report only that they exist.
    ...(aiGatewayApiKeys?.length ? { aiGatewayApiKeyCount: aiGatewayApiKeys.length } : {}),
    ...(vertexByokCredential ? { hasVertexByokCredential: true } : {}),
  };
}
