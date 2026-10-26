import type { OpenAIProvider } from '@ai-sdk/openai';
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable, Logger } from '@nestjs/common';
import {
  findProviderForModelKey,
  LLMProviderType,
  parseModelKey,
  providerListsModelKey,
  SettingKey,
} from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi';
import type { EmbeddingModel, ImageModel, LanguageModel } from 'ai';
import { createGateway } from 'ai';
import { CustomHttpException } from '../../../custom.exception';
import { ProviderSecretService } from '../../setting/provider-secret.service';
import { SettingService } from '../../setting/setting.service';
import { getAdaptedProviderOptions, modelProviders } from '../util';

// Fixed name for all instance (platform-provided) providers in modelKey.
// Instance models always end with @teable (e.g. "aiGateway@model@teable", "anthropic@model@teable").
// BYOK (space-configured) providers keep their custom name (e.g. "openai@model@my-custom").
export const INSTANCE_PROVIDER_NAME = 'teable';

export type ILanguageModelV2 = Exclude<LanguageModel, string>;

const configurationNotSetKey = 'httpErrors.ai.configurationNotSet';

/** Provider types that can be called without an API key (local Ollama, self-hosted endpoints). */
const keylessProviderTypes: LLMProviderType[] = [
  LLMProviderType.OLLAMA,
  LLMProviderType.OPENAI_COMPATIBLE,
];

const aiNotSetMessage = 'AI configuration is not set';

@Injectable()
export class ModelResolverService {
  private readonly logger = new Logger(ModelResolverService.name);

  constructor(
    private readonly settingService: SettingService,
    private readonly providerSecretService: ProviderSecretService
  ) {}

  public parseModelKey(modelKey: string) {
    const { type, model, ref } = parseModelKey(modelKey);
    return { type, model, name: ref };
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
    return providerListsModelKey(modelKey, llmProviders);
  }

  // modelKey -> type@model@<provider id | legacy name | teable>
  async getModelConfig(modelKey: string, llmProviders: LLMProvider[] = []) {
    const { type, model } = this.parseModelKey(modelKey);

    if (this.isGatewayModel(modelKey)) {
      const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);

      const gatewayApiKey = this.providerSecretService.resolveGatewayKey(aiConfig);
      if (!gatewayApiKey) {
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
        baseUrl: aiConfig?.aiGatewayBaseUrl || undefined,
        apiKey: gatewayApiKey,
      };
    }

    const providerConfig = findProviderForModelKey(modelKey, llmProviders);

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

    const { baseUrl } = providerConfig;
    // Stored keys are encrypted; env-var keys are read at call time.
    const apiKey = this.providerSecretService.resolveKey(providerConfig);
    if (!apiKey && providerConfig.apiKeyEnv) {
      throw new CustomHttpException(
        `AI provider "${providerConfig.name}" reads its key from ${providerConfig.apiKeyEnv}, which is not set`,
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: configurationNotSetKey } }
      );
    }

    return {
      type,
      model,
      baseUrl,
      apiKey,
      headers: this.providerSecretService.resolveHeaders(providerConfig),
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
    const config = await this.getModelConfig(modelKey, llmProviders);
    const { type, model, baseUrl, apiKey } = config;
    const headers = 'headers' in config ? config.headers : undefined;

    if (type === LLMProviderType.AI_GATEWAY) {
      if (!apiKey) {
        throw new CustomHttpException(aiNotSetMessage, HttpErrorCode.VALIDATION_ERROR, {
          localization: {
            i18nKey: configurationNotSetKey,
          },
        });
      }
      const gatewayProvider = createGateway({
        apiKey,
        ...(baseUrl && { baseURL: baseUrl }),
      });
      return isImageGeneration ? gatewayProvider.imageModel(model) : gatewayProvider(model);
    }

    // Local and self-hosted OpenAI-compatible endpoints may run without a key.
    const keyless = keylessProviderTypes.includes(type as LLMProviderType);
    if (!baseUrl || (!apiKey && !keyless)) {
      throw new CustomHttpException(aiNotSetMessage, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: configurationNotSetKey,
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
      apiKey: apiKey ?? '',
      headers,
    });
    const modelProvider = provider(providerOptions as never) as OpenAIProvider;

    return isImageGeneration
      ? (modelProvider.image(model) as ReturnType<OpenAIProvider['image']>)
      : modelProvider(model);
  }

  /**
   * An embedding model for a model key (the agent's knowledge search). Uses the same provider
   * settings as chat models; providers without an embedding API are refused.
   */
  async getEmbeddingModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[] = []
  ): Promise<EmbeddingModel> {
    const config = await this.getModelConfig(modelKey, llmProviders);
    const { type, model, baseUrl, apiKey } = config;
    const headers = 'headers' in config ? config.headers : undefined;
    type IEmbeddingCapable = {
      embeddingModel?: (id: string) => EmbeddingModel;
      textEmbeddingModel?: (id: string) => EmbeddingModel;
    };
    let instance: IEmbeddingCapable;
    if (type === LLMProviderType.AI_GATEWAY) {
      if (!apiKey) {
        throw new CustomHttpException(aiNotSetMessage, HttpErrorCode.VALIDATION_ERROR);
      }
      instance = createGateway({ apiKey, ...(baseUrl && { baseURL: baseUrl }) }) as never;
    } else {
      const keyless = keylessProviderTypes.includes(type as LLMProviderType);
      if (!baseUrl || (!apiKey && !keyless)) {
        throw new CustomHttpException(aiNotSetMessage, HttpErrorCode.VALIDATION_ERROR);
      }
      const provider = Object.entries(modelProviders).find(
        ([key]) => type.toLowerCase() === key.toLowerCase()
      )?.[1];
      if (!provider) {
        throw new CustomHttpException(
          `Unsupported AI provider: ${type}`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
      const options = getAdaptedProviderOptions(type as LLMProviderType, {
        name: model,
        baseURL: baseUrl,
        apiKey: apiKey ?? '',
        headers,
      });
      instance = provider(options as never) as unknown as IEmbeddingCapable;
    }
    const make = instance.embeddingModel ?? instance.textEmbeddingModel;
    if (!make) {
      throw new CustomHttpException(
        `Provider type ${type} has no embedding models`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return make.call(instance, model);
  }
}
