import { Injectable, Logger } from '@nestjs/common';
import type { GatewayModelTag, IChatModelAbility, LLMProvider } from '@teable/openapi';
import {
  LLMProviderType,
  supportsImageInputForImageGeneration,
  findProviderForModelKey,
  SettingKey,
} from '@teable/openapi';
import { SettingService } from '../../setting/setting.service';
import { GatewayModelService } from './gateway-model.service';
import { ModelResolverService } from './model-resolver.service';
import type { ILanguageModelV2 } from './model-resolver.service';

@Injectable()
export class ModelCapabilityService {
  private readonly logger = new Logger(ModelCapabilityService.name);

  constructor(
    private readonly gatewayModelService: GatewayModelService,
    private readonly modelResolverService: ModelResolverService,
    private readonly settingService: SettingService
  ) {}

  /**
   * Get model capability tags for any model (AI Gateway or custom provider).
   *
   * Priority:
   * 1. AI Gateway: from getGatewayModelConfig().tags
   * 2. Custom Provider: from modelConfigs[model].tags
   * 3. Fallback: convert deprecated ability field to tags (backward compatibility)
   */
  async getModelTags(modelKey: string, llmProviders: LLMProvider[]): Promise<GatewayModelTag[]> {
    const { type, model } = this.modelResolverService.parseModelKey(modelKey);

    if (type === LLMProviderType.AI_GATEWAY) {
      try {
        const gatewayModel = await this.gatewayModelService.getGatewayModelConfig(model);
        if (gatewayModel) {
          return this.addImageInputTagForImageGeneration(model, gatewayModel.tags ?? []);
        }
      } catch (error) {
        this.logger.warn(`[getModelTags] Failed to get gateway config for ${model}: ${error}`);
      }
      return [];
    }

    const provider = findProviderForModelKey(modelKey, llmProviders);
    const modelConfig = provider?.modelConfigs?.[model];

    if (modelConfig?.tags?.length) {
      return modelConfig.tags;
    }

    if (modelConfig?.ability) {
      return this.abilityToTags(modelConfig.ability);
    }

    return [];
  }

  private addImageInputTagForImageGeneration(
    modelId: string,
    tags: readonly GatewayModelTag[]
  ): GatewayModelTag[] {
    const nextTags = [...tags];
    if (supportsImageInputForImageGeneration(modelId, nextTags) && !nextTags.includes('vision')) {
      nextTags.push('vision');
    }
    return nextTags;
  }

  /**
   * Convert deprecated IChatModelAbility to GatewayModelTag[] for backward compatibility.
   */
  abilityToTags(ability: IChatModelAbility): GatewayModelTag[] {
    const tags: GatewayModelTag[] = [];
    if (ability.image) tags.push('vision');
    if (ability.pdf) tags.push('file-input');
    if (ability.toolCall) tags.push('tool-use');
    if (ability.reasoning) tags.push('reasoning');
    if (ability.imageGeneration) tags.push('image-generation');
    return tags;
  }

  /**
   * Find the first model that supports vision capability from configured models.
   * Searches in order: gateway models (enabled), then custom llm providers.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity
  async findFirstVisionModel(llmProviders: LLMProvider[]): Promise<
    | {
        modelKey: string;
        modelInstance: ILanguageModelV2;
        isInstance: boolean;
        tags: GatewayModelTag[];
      }
    | undefined
  > {
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

    // 1. Check gateway models first (they are typically more capable)
    const gatewayModels = aiConfig?.gatewayModels ?? [];
    for (const model of gatewayModels) {
      if (!model.enabled) continue;

      if (model.tags?.includes('vision')) {
        const modelKey = this.modelResolverService.buildGatewayModelKey(model.id);
        const modelInstance = await this.modelResolverService.getModelInstance(
          modelKey,
          llmProviders
        );
        return {
          modelKey,
          modelInstance,
          isInstance: true,
          tags: model.tags,
        };
      }
    }

    // 2. Check custom LLM providers
    for (const provider of llmProviders) {
      const models = provider.models?.split(',').map((m) => m.trim()) ?? [];
      for (const model of models) {
        const modelConfig = provider.modelConfigs?.[model];
        if (!modelConfig) continue;

        const hasVision = modelConfig.tags?.includes('vision') || modelConfig.ability?.image;
        if (hasVision) {
          const modelKey = `${provider.type}@${model}@${provider.name}`;
          const modelInstance = await this.modelResolverService.getModelInstance(
            modelKey,
            llmProviders
          );
          const tags: GatewayModelTag[] =
            modelConfig.tags ?? this.abilityToTags(modelConfig.ability ?? {});
          return {
            modelKey,
            modelInstance,
            isInstance: !!provider.isInstance,
            tags,
          };
        }
      }
    }

    return undefined;
  }
}
