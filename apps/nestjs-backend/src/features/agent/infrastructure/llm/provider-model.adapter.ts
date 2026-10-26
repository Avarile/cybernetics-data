import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import type { IAIConfig, LLMProvider } from '@teable/openapi';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import { CustomHttpException } from '../../../../custom.exception';
import { AiService } from '../../../ai/ai.service';
import { GATEWAY_PROVIDER_ID } from '../../../setting/provider-secret.service';
import { SettingService } from '../../../setting/setting.service';
import type { IModelPort, IModelRef, IResolvedModel } from '../../domain/ports';

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
}
