import { HttpErrorCode } from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import type {
  GatewayModelTag,
  IAiProviderModelsVo,
  IChatModelAbility,
  ITestAiProviderModelsVo,
  ITestAiProviderRo,
  ITestAiProviderVo,
  LLMProvider,
} from '@teable/openapi';
import { buildModelKey, LLMProviderType } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from '../setting/provider-secret.service';
import { AiProviderService } from './ai-provider.service';
import { canListModels, probeModels } from './provider-probe';
import type { IProbeTarget } from './provider-probe';

const modelTestConcurrency = 3;

const abilityToTags = (ability: IChatModelAbility | undefined): GatewayModelTag[] => {
  const tags: GatewayModelTag[] = [];
  if (!ability) return tags;
  if (ability.image) tags.push('vision');
  if (ability.pdf) tags.push('file-input');
  if (ability.toolCall) tags.push('tool-use');
  if (ability.reasoning) tags.push('reasoning');
  if (ability.imageGeneration) tags.push('image-generation');
  return tags;
};

const firstModel = (models: string | undefined) =>
  (models ?? '')
    .split(',')
    .map((m) => m.trim())
    .find(Boolean);

/**
 * Connection tests and model listing for providers. A saved provider's key is decrypted here and
 * never leaves the server; a draft's key is used for this one request and not stored.
 */
@Injectable()
export class AiProviderTestService {
  private readonly logger = new Logger(AiProviderTestService.name);

  constructor(
    private readonly providers: AiProviderService,
    private readonly secrets: ProviderSecretService,
    private readonly settingOpenApi: SettingOpenApiService
  ) {}

  async test(ro: ITestAiProviderRo): Promise<ITestAiProviderVo> {
    const saved = ro.providerId ? await this.providers.getStored(ro.providerId) : undefined;
    if (!saved && !ro.draft?.type) {
      throw new CustomHttpException(
        'A provider id or a draft type is required',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const merged = { ...saved, ...ro.draft } as LLMProvider;
    const target = this.target(merged, saved, ro.draft?.apiKey);
    const model = ro.model ?? firstModel(merged.models);

    const result =
      canListModels(target.type) && target.type !== LLMProviderType.AI_GATEWAY
        ? await probeModels(target)
        : await this.generationProbe(merged, target, model);

    // Only an unchanged saved provider gets its health updated.
    if (saved && !ro.draft) {
      await this.providers.recordTest(saved.id!, result.ok, result.ok ? undefined : result.error);
    }
    return result;
  }

  async models(providerId: string): Promise<IAiProviderModelsVo> {
    const provider = await this.providers.getStored(providerId);
    const configured = (provider.models ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (!canListModels(provider.type)) return { models: configured, fetched: false };
    const result = await probeModels(this.target(provider, provider));
    if (!result.ok)
      return { models: configured, fetched: false, error: result.hint ?? result.error };
    return { models: [...new Set([...(result.models ?? []), ...configured])], fetched: true };
  }

  async testModels(providerId: string, models: string[]): Promise<ITestAiProviderModelsVo> {
    if (providerId === GATEWAY_PROVIDER_ID) {
      throw new CustomHttpException(
        'Gateway models are tested from the Gateway model pool',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const provider = await this.providers.getStored(providerId);
    const target = this.target(provider, provider);
    const results: ITestAiProviderModelsVo['results'] = [];
    for (let i = 0; i < models.length; i += modelTestConcurrency) {
      const batch = models.slice(i, i + modelTestConcurrency);
      results.push(...(await Promise.all(batch.map((m) => this.testModel(provider, target, m)))));
    }
    const testedAt = Date.now();
    await this.providers.recordModelConfigs(
      providerId,
      Object.fromEntries(
        results
          .filter((r) => r.ok)
          .map((r) => [
            r.model,
            { ...provider.modelConfigs?.[r.model], ability: r.ability, tags: r.tags, testedAt },
          ])
      )
    );
    return { results };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Resolved call target: draft key first, else the saved key (decrypted) or env var. */
  private target(provider: LLMProvider, saved?: LLMProvider, draftKey?: string): IProbeTarget {
    let apiKey = draftKey || undefined;
    if (!apiKey && provider.apiKeyEnv && provider.apiKeyEnv !== saved?.apiKeyEnv) {
      apiKey = this.secrets.resolveKey({ apiKeyEnv: provider.apiKeyEnv });
    }
    if (!apiKey && saved) {
      apiKey =
        saved.id === GATEWAY_PROVIDER_ID
          ? this.secrets.resolveGatewayKey({ aiGatewayApiKey: saved.apiKey }) ??
            process.env.AI_GATEWAY_API_KEY
          : this.secrets.resolveKey(saved);
    }
    return {
      type: provider.type,
      baseUrl: provider.baseUrl,
      apiKey,
      headers: this.secrets.resolveHeaders(provider),
    };
  }

  /** For types without a model listing: one short generation through the existing LLM test. */
  private async generationProbe(
    provider: LLMProvider,
    target: IProbeTarget,
    model: string | undefined
  ): Promise<ITestAiProviderVo> {
    const started = Date.now();
    if (!model) {
      return { ok: false, latencyMs: 0, error: 'Add at least one model to test this provider.' };
    }
    try {
      await this.settingOpenApi.testLLM({
        type: target.type,
        name: provider.name,
        baseUrl: target.baseUrl ?? '',
        apiKey: target.apiKey ?? '',
        models: model,
      });
      return { ok: true, latencyMs: Date.now() - started, models: [model] };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, error: (e as Error).message };
    }
  }

  private async testModel(provider: LLMProvider, target: IProbeTarget, model: string) {
    try {
      const res = await this.settingOpenApi.testLLM({
        type: target.type,
        name: provider.name,
        baseUrl: target.baseUrl ?? '',
        apiKey: target.apiKey ?? '',
        models: model,
        modelKey: buildModelKey(provider, model),
        ability: ['toolCall', 'image'],
      });
      return { model, ok: true, ability: res.ability, tags: abilityToTags(res.ability) };
    } catch (e) {
      this.logger.warn(`Model test failed for ${provider.id}/${model}: ${(e as Error).message}`);
      return { model, ok: false, error: (e as Error).message, tags: [] };
    }
  }
}
