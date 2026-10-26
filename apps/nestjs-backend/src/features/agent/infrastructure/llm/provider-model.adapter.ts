import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import type { IAIConfig, IModelConfig, LLMProvider } from '@teable/openapi';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import { AiService } from '../../../ai/ai.service';
import { GATEWAY_PROVIDER_ID } from '../../../setting/provider-secret.service';
import { SettingService } from '../../../setting/setting.service';
import type { IModelPort, IModelPrice, IModelRef, IResolvedModel } from '../../domain/ports';

/** Split `providerId/model`; the model part may itself contain `/` (gateway ids). */
export function parseModelRef(ref: IModelRef): { providerId: string; model: string } {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    throw new CustomHttpException(
      `Agent model "${ref}" must look like providerId/model`,
      HttpErrorCode.VALIDATION_ERROR
    );
  }
  return { providerId: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

/** The model key for a ref, given the instance providers. */
export function modelKeyForRef(ref: IModelRef, providers: LLMProvider[]): string {
  const { providerId, model } = parseModelRef(ref);
  if (providerId === GATEWAY_PROVIDER_ID) return `${LLMProviderType.AI_GATEWAY}@${model}@teable`;
  const provider = providers.find((p) => p.id === providerId && p.enabled !== false);
  if (!provider) {
    throw new CustomHttpException(
      `Agent model "${ref}": provider "${providerId}" is not configured or disabled`,
      HttpErrorCode.VALIDATION_ERROR
    );
  }
  return `${provider.type}@${model}@${providerId}`;
}

const usdPerCredit = 0.01;
const tokensPerRateUnit = 1_000_000;

/** USD per token from a model config: `pricing` (USD strings), else legacy credits per 1M. */
export function priceOf(config: IModelConfig | undefined): IModelPrice | undefined {
  if (!config) return undefined;
  const fromPricing = (v?: string) => (v !== undefined && v !== '' ? Number(v) : undefined);
  const fromRate = (r?: number) =>
    r !== undefined ? (r * usdPerCredit) / tokensPerRateUnit : undefined;
  const input = fromPricing(config.pricing?.input) ?? fromRate(config.inputRate);
  const output = fromPricing(config.pricing?.output) ?? fromRate(config.outputRate);
  if (input === undefined && output === undefined) return undefined;
  return {
    input: Number.isFinite(input) ? input! : 0,
    output: Number.isFinite(output) ? output! : 0,
  };
}

/** ModelPort backed by the instance provider registry (Admin > AI Settings). */
@Injectable()
export class ProviderModelAdapter implements IModelPort {
  constructor(
    private readonly settingService: SettingService,
    private readonly aiService: AiService
  ) {}

  async resolve(ref: IModelRef): Promise<IResolvedModel> {
    const aiConfig = await this.settingService.getStoredSetting<IAIConfig>(SettingKey.AI_CONFIG);
    const providers = (aiConfig?.llmProviders ?? []).map((p) => ({ ...p, isInstance: true }));
    const modelKey = modelKeyForRef(ref, providers);
    const model = await this.aiService.getModelInstance(modelKey, providers);
    return { ref, modelKey, model };
  }

  async embedder(ref: IModelRef) {
    const aiConfig = await this.settingService.getStoredSetting<IAIConfig>(SettingKey.AI_CONFIG);
    const providers = (aiConfig?.llmProviders ?? []).map((p) => ({ ...p, isInstance: true }));
    const modelKey = modelKeyForRef(ref, providers);
    const model = await this.aiService.getEmbeddingModelInstance(modelKey, providers);
    return { ref, modelKey, model };
  }

  async reranker(ref: IModelRef) {
    const aiConfig = await this.settingService.getStoredSetting<IAIConfig>(SettingKey.AI_CONFIG);
    const providers = (aiConfig?.llmProviders ?? []).map((p) => ({ ...p, isInstance: true }));
    const modelKey = modelKeyForRef(ref, providers);
    const model = await this.aiService.getRerankingModelInstance(modelKey, providers);
    return { ref, modelKey, model };
  }

  async price(ref: IModelRef): Promise<IModelPrice | undefined> {
    const aiConfig = await this.settingService.getStoredSetting<IAIConfig>(SettingKey.AI_CONFIG);
    const { providerId, model } = parseModelRef(ref);
    const provider = (aiConfig?.llmProviders ?? []).find((p) => p.id === providerId);
    return priceOf(provider?.modelConfigs?.[model]);
  }
}
