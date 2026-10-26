import { Injectable } from '@nestjs/common';
import type { IAIConfig, IProviderUsage, LLMProvider } from '@teable/openapi';
import { findProviderForModelKey, LLMProviderType, parseModelKey } from '@teable/openapi';
import { GATEWAY_PROVIDER_ID } from '../setting/provider-secret.service';

/** A model key something depends on, and what to call that something in the UI. */
export type IModelKeyUsage = IProviderUsage;

/** Another feature (the agent's model slots) reporting which model keys it uses. */
export type IProviderUsageSource = () => Promise<IModelKeyUsage[]>;

/** The model keys the instance aiConfig itself references. */
export function aiConfigUsages(aiConfig: IAIConfig | null | undefined): IModelKeyUsage[] {
  const out: IModelKeyUsage[] = [];
  const push = (kind: IModelKeyUsage['kind'], label: string, key?: string | null) => {
    if (key) out.push({ kind, label, modelKey: key });
  };
  for (const tier of ['lg', 'md', 'sm'] as const) {
    push('chat-model', `Default chat model (${tier})`, aiConfig?.chatModel?.[tier]);
  }
  push('embedding-model', 'Embedding model', aiConfig?.embeddingModel);
  push('translation-model', 'Translation model', aiConfig?.translationModel);
  return out;
}

/** Which provider id a model key resolves to (Gateway keys belong to the Gateway entry). */
export function providerIdForKey(modelKey: string, providers: LLMProvider[]): string | undefined {
  if (parseModelKey(modelKey).type === LLMProviderType.AI_GATEWAY) return GATEWAY_PROVIDER_ID;
  return findProviderForModelKey(modelKey, providers)?.id;
}

/** Usages grouped by the provider id they resolve to. */
export function groupUsages(
  usages: IModelKeyUsage[],
  providers: LLMProvider[]
): Map<string, IModelKeyUsage[]> {
  const byProvider = new Map<string, IModelKeyUsage[]>();
  for (const usage of usages) {
    const id = providerIdForKey(usage.modelKey, providers);
    if (!id) continue;
    byProvider.set(id, [...(byProvider.get(id) ?? []), usage]);
  }
  return byProvider;
}

/**
 * Collects usages from features outside the provider registry, so the agent module can block
 * deleting a provider its model slots use without the registry depending on the agent.
 */
@Injectable()
export class ProviderUsageRegistry {
  private readonly sources: IProviderUsageSource[] = [];

  register(source: IProviderUsageSource) {
    this.sources.push(source);
  }

  async collect(): Promise<IModelKeyUsage[]> {
    const results = await Promise.allSettled(this.sources.map((source) => source()));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }
}
