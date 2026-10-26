import type { LLMProvider } from './update';

/** Legacy suffix of every instance provider's model keys, from when providers had no ids. */
export const LEGACY_INSTANCE_REF = 'teable';

export interface IParsedModelKey {
  type: string;
  model: string;
  /** Provider id, a legacy provider name, or the legacy `teable` alias. */
  ref: string;
}

/** `type@model@ref`. Model ids may contain `@`, so type is the first and ref the last segment. */
export function parseModelKey(modelKey: string): IParsedModelKey {
  const parts = modelKey.split('@');
  if (parts.length < 3) return { type: parts[0] ?? '', model: parts[1] ?? '', ref: '' };
  return { type: parts[0], model: parts.slice(1, -1).join('@'), ref: parts[parts.length - 1] };
}

const sameType = (p: LLMProvider, type: string) => p.type.toLowerCase() === type.toLowerCase();
const listsModel = (p: LLMProvider, model: string) =>
  p.models
    .split(',')
    .map((m) => m.trim())
    .includes(model);

/**
 * The provider a model key points at:
 * 1. a provider whose id is the ref (current keys: `openaiCompatible@qwen3@vllm-gpu01`);
 * 2. a provider whose name is the ref (space-level BYOK providers, which have no ids);
 * 3. `teable` (legacy instance keys): the first instance provider of that type listing the model,
 *    else the first instance provider of that type.
 * Disabled providers never match.
 */
export function findProviderForModelKey(
  modelKey: string,
  providers: LLMProvider[]
): LLMProvider | undefined {
  const { type, model, ref } = parseModelKey(modelKey);
  const candidates = providers.filter((p) => p.enabled !== false && sameType(p, type));

  const byId = candidates.find((p) => p.id === ref);
  if (byId) return byId;

  const byName = candidates.filter((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (byName.length) return byName.find((p) => listsModel(p, model)) ?? byName[0];

  if (ref.toLowerCase() === LEGACY_INSTANCE_REF) {
    // Lists merged with space providers flag instance ones; raw instance lists carry no flag.
    const flagged = candidates.filter((p) => p.isInstance);
    const instance = flagged.length ? flagged : candidates.filter((p) => p.isInstance !== false);
    return instance.find((p) => listsModel(p, model)) ?? instance[0];
  }
  return undefined;
}

/** Whether a model key names a model the matched provider actually lists. */
export function providerListsModelKey(modelKey: string, providers: LLMProvider[]): boolean {
  const provider = findProviderForModelKey(modelKey, providers);
  return Boolean(provider && listsModel(provider, parseModelKey(modelKey).model));
}

/** The current key for a model of a provider. */
export function buildModelKey(provider: Pick<LLMProvider, 'type' | 'id' | 'name'>, model: string) {
  return `${provider.type}@${model}@${provider.id ?? provider.name}`;
}
