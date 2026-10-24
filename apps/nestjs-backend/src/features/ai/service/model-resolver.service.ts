import type { OpenAIProvider } from '@ai-sdk/openai';
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi';
import type { ImageModel, LanguageModel } from 'ai';
import { createGateway } from 'ai';
import { CustomHttpException } from '../../../custom.exception';
import { SettingService } from '../../setting/setting.service';
import { getAdaptedProviderOptions, modelProviders } from '../util';

// Fixed name for all instance (platform-provided) providers in modelKey.
// Instance models always end with @teable (e.g. "aiGateway@model@teable", "anthropic@model@teable").
// BYOK (space-configured) providers keep their custom name (e.g. "openai@model@my-custom").
export const INSTANCE_PROVIDER_NAME = 'teable';

export type ILanguageModelV2 = Exclude<LanguageModel, string>;

@Injectable()
export class ModelResolverService {
  private readonly logger = new Logger(ModelResolverService.name);

  constructor(private readonly settingService: SettingService) {}

  public parseModelKey(modelKey: string) {
    const [type, model, name] = modelKey.split('@');
    return { type, model, name };
  }

  /**
   * Check if modelKey is an AI Gateway model.
   * Format: aiGateway@<modelId>@teable
   */
  public isGatewayModel(modelKey: string): boolean {
    const { type } = this.parseModelKey(modelKey);
    return type?.toLowerCase() === LLMProviderType.AI_GATEWAY.toLowerCase();
  }

  /**
   * Build a gateway modelKey from a gateway model ID.
   * @param modelId Gateway model ID (e.g., "anthropic/claude-sonnet-4")
   */
  public buildGatewayModelKey(modelId: string): string {
    return `${LLMProviderType.AI_GATEWAY}@${modelId}@${INSTANCE_PROVIDER_NAME}`;
  }

  /**
   * Check if a model is an instance (platform-provided) model.
   * Instance models use the "@teable" provider name suffix.
   */
  checkInstanceAIModel(modelKey: string): boolean {
    return modelKey.endsWith(`@${INSTANCE_PROVIDER_NAME}`);
  }

  findModelInProviders(modelKey: string, llmProviders: LLMProvider[]): boolean {
    const { type, model, name } = this.parseModelKey(modelKey);

    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() &&
        p.type.toLowerCase() === type.toLowerCase() &&
        p.models.includes(model)
    );
    return !!providerConfig;
  }

  // modelKey -> type@model@name
  async getModelConfig(modelKey: string, llmProviders: LLMProvider[] = []) {
    const { type, model, name } = this.parseModelKey(modelKey);

    if (this.isGatewayModel(modelKey)) {
      const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

      if (!aiConfig?.aiGatewayApiKey) {
        throw new CustomHttpException(
          'AI Gateway API key is not configured',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.ai.gatewayApiKeyNotSet',
            },
          }
        );
      }

      return {
        type: LLMProviderType.AI_GATEWAY,
        model,
        baseUrl: aiConfig.aiGatewayBaseUrl || undefined,
        apiKey: aiConfig.aiGatewayApiKey,
      };
    }

    const providerConfig = llmProviders.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() && p.type.toLowerCase() === type.toLowerCase()
    );

    if (!providerConfig) {
      throw new CustomHttpException(
        'AI provider configuration is not set',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.providerConfigurationNotSet',
          },
        }
      );
    }

    const { baseUrl, apiKey } = providerConfig;

    return {
      type,
      model,
      baseUrl,
      apiKey,
    };
  }

  async getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[],
    isImageGeneration: true
  ): Promise<ReturnType<OpenAIProvider['image']>>;
  async getModelInstance(
    modelKey: string,
    llmProviders?: LLMProvider[],
    isImageGeneration?: false
  ): Promise<ILanguageModelV2>;
  async getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[] = [],
    isImageGeneration = false
  ): Promise<ILanguageModelV2 | ImageModel> {
    const { type, model, baseUrl, apiKey } = await this.getModelConfig(modelKey, llmProviders);

    if (type === LLMProviderType.AI_GATEWAY) {
      if (!apiKey) {
        throw new CustomHttpException(
          'AI configuration is not set',
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.ai.configurationNotSet',
            },
          }
        );
      }
      const gatewayProvider = createGateway({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      return isImageGeneration ? gatewayProvider.imageModel(model) : gatewayProvider(model);
    }

    if (!baseUrl || !apiKey) {
      throw new CustomHttpException('AI configuration is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.configurationNotSet',
        },
      });
    }

    const provider = Object.entries(modelProviders).find(
      ([key]) => type.toLowerCase() === key.toLowerCase()
    )?.[1];

    if (!provider) {
      throw new CustomHttpException(
        `Unsupported AI provider: ${type}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.ai.unsupportedProvider',
            context: {
              type,
            },
          },
        }
      );
    }

    const providerOptions = getAdaptedProviderOptions(type as LLMProviderType, {
      name: model,
      baseURL: baseUrl,
      apiKey,
    });
    const modelProvider = provider(providerOptions as never) as OpenAIProvider;

    return isImageGeneration
      ? (modelProvider.image(model) as ReturnType<OpenAIProvider['image']>)
      : modelProvider(model);
  }
}
