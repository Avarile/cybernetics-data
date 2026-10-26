import type { IAIConfig, LLMProvider } from '@teable/openapi';
import { isProviderIdAllowed, providerTypeLabel, suggestProviderId } from '@teable/openapi';

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

/** Legacy name every instance provider was forced to before providers had ids. */
const legacyName = 'teable';

/**
 * Real display names for providers saved under the legacy name (or none): the type's label, made
 * unique per type ("OpenAI-compatible", "OpenAI-compatible 2"). Model keys do not change: legacy
 * `@teable` keys keep resolving through the alias in provider-match.
 */
export function relabelProviders(providers: LLMProvider[]): {
  providers: LLMProvider[];
  changed: boolean;
} {
  const used = new Set(
    providers.filter((p) => p.name && p.name !== legacyName).map((p) => p.name.toLowerCase())
  );
  let changed = false;
  const out = providers.map((p) => {
    if (p.name && p.name !== legacyName) return p;
    changed = true;
    const base = providerTypeLabel(p.type);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    used.add(name.toLowerCase());
    return { ...p, name };
  });
  return { providers: out, changed };
}

/**
 * One-off, idempotent migration of a stored aiConfig: ids and real names for every provider, every
 * plain key (providers and the Gateway key) encrypted.
 */
export function migrateAiConfig(
  aiConfig: IAIConfig,
  crypto: IKeyCrypto,
  gatewayProviderId: string
): { aiConfig: IAIConfig; changed: boolean } {
  const withIds = assignProviderIds(aiConfig.llmProviders ?? []);
  const named = relabelProviders(withIds.providers);
  let changed = withIds.changed || named.changed;
  const llmProviders = named.providers.map((p) => {
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

/**
 * Apply a PATCH of the aiConfig setting. Providers and the Gateway key are managed only through the
 * provider routes (/api/admin/ai/providers), so the stored values always win for them; the masked
 * read-only fields the UI got from GET are dropped. Everything else comes from the request.
 */
export function applyAiConfigPatch(
  stored: IAIConfig | undefined | null,
  incoming: IAIConfig
): IAIConfig {
  const {
    aiGatewayApiKeyPreview: _p,
    aiGatewayApiKeyCount: _c,
    hasVertexByokCredential: _v,
    ...rest
  } = incoming as IAIConfig & {
    aiGatewayApiKeyPreview?: string;
    aiGatewayApiKeyCount?: number;
    hasVertexByokCredential?: boolean;
  };
  // Masked on read (see maskAiConfig), so a request without them keeps the stored values.
  const aiGatewayApiKeys = incoming.aiGatewayApiKeys ?? stored?.aiGatewayApiKeys;
  const vertexByokCredential = incoming.vertexByokCredential ?? stored?.vertexByokCredential;
  return {
    ...rest,
    llmProviders: stored?.llmProviders ?? [],
    aiGatewayApiKey: stored?.aiGatewayApiKey ?? null,
    aiGatewayBaseUrl: stored?.aiGatewayBaseUrl ?? null,
    ...(stored?.aiGatewayMeta ? { aiGatewayMeta: stored.aiGatewayMeta } : {}),
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
