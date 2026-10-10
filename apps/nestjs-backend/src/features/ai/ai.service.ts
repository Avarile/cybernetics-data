/**
 * AiService — thin facade that composes all AI sub-services.
 * External modules should inject AiService; sub-services are implementation details.
 */
import type { OpenAIProvider } from '@ai-sdk/openai';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import type { IAiGenerateRo, IGetAIConfig, GatewayModelTag, LLMProvider } from '@teable/openapi';
import type { ImageModel } from 'ai';
import type { Response } from 'express';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import { CustomHttpException } from '../../custom.exception';
import {
  AiConfigService,
  GatewayModelService,
  GenerationService,
  MastraClientService,
  ModelCapabilityService,
  ModelResolverService,
  TtsService,
  INSTANCE_PROVIDER_NAME,
} from './service';
import type { ILanguageModelV2, IMastraThread } from './service';

export { INSTANCE_PROVIDER_NAME };
export type { ILanguageModelV2 };

@Injectable()
export class AiService {
  constructor(
    private readonly aiConfigService: AiConfigService,
    private readonly gatewayModelService: GatewayModelService,
    private readonly generationService: GenerationService,
    private readonly mastraClientService: MastraClientService,
    private readonly modelCapabilityService: ModelCapabilityService,
    private readonly modelResolverService: ModelResolverService,
    private readonly ttsService: TtsService,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  // ── Config ────────────────────────────────────────────────────────────────

  getAIConfig(baseId: string): Promise<IGetAIConfig> {
    return this.aiConfigService.getAIConfig(baseId);
  }

  getAIDisableAIActions(baseId: string) {
    return this.aiConfigService.getAIDisableAIActions(baseId);
  }

  getSimplifiedAIConfig(baseId: string) {
    return this.aiConfigService.getSimplifiedAIConfig(baseId);
  }

  getInstanceAIConfig() {
    return this.aiConfigService.getInstanceAIConfig(this.baseConfig.isCloud);
  }

  getAttachmentTransferMode() {
    return this.aiConfigService.getAttachmentTransferMode();
  }

  // ── Model resolution ──────────────────────────────────────────────────────

  parseModelKey(modelKey: string) {
    return this.modelResolverService.parseModelKey(modelKey);
  }

  isGatewayModel(modelKey: string): boolean {
    return this.modelResolverService.isGatewayModel(modelKey);
  }

  buildGatewayModelKey(modelId: string): string {
    return this.modelResolverService.buildGatewayModelKey(modelId);
  }

  checkInstanceAIModel(modelKey: string): boolean {
    return this.modelResolverService.checkInstanceAIModel(modelKey);
  }

  findModelInProviders(modelKey: string, llmProviders: LLMProvider[]): boolean {
    return this.modelResolverService.findModelInProviders(modelKey, llmProviders);
  }

  getModelConfig(modelKey: string, llmProviders: LLMProvider[] = []) {
    return this.modelResolverService.getModelConfig(modelKey, llmProviders);
  }

  getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[],
    isImageGeneration: true
  ): Promise<ReturnType<OpenAIProvider['image']>>;
  getModelInstance(
    modelKey: string,
    llmProviders?: LLMProvider[],
    isImageGeneration?: false
  ): Promise<ILanguageModelV2>;
  getModelInstance(
    modelKey: string,
    llmProviders: LLMProvider[] = [],
    isImageGeneration = false
  ): Promise<ILanguageModelV2 | ImageModel> {
    return this.modelResolverService.getModelInstance(
      modelKey,
      llmProviders,
      isImageGeneration as false
    );
  }

  async getChatModelInstance(baseId: string) {
    const { chatModel, llmProviders } = await this.aiConfigService.getAIConfig(baseId);
    if (!chatModel?.lg) {
      throw new CustomHttpException('AI chat model lg is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.ai.chatModelLgNotSet' },
      });
    }

    const isGateway = this.modelResolverService.isGatewayModel(chatModel.lg);
    let isInstance = false;

    if (isGateway) {
      isInstance = true;
    } else {
      const { type, model, name } = this.modelResolverService.parseModelKey(chatModel.lg);
      const lgProvider = llmProviders.find(
        (p) =>
          p.name.toLowerCase() === name.toLowerCase() &&
          p.type.toLowerCase() === type.toLowerCase() &&
          p.models.includes(model)
      );
      if (!lgProvider) {
        throw new CustomHttpException(
          'AI chat model lg provider is not set',
          HttpErrorCode.VALIDATION_ERROR,
          { localization: { i18nKey: 'httpErrors.ai.chatModelLgProviderNotSet' } }
        );
      }
      isInstance = !!lgProvider.isInstance;
    }

    if (!chatModel?.sm) {
      throw new CustomHttpException('AI chat model sm is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.ai.chatModelSmNotSet' },
      });
    }
    if (!chatModel?.md) {
      throw new CustomHttpException('AI chat model md is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.ai.chatModelMdNotSet' },
      });
    }

    return {
      sm: await this.modelResolverService.getModelInstance(chatModel.sm, llmProviders),
      md: await this.modelResolverService.getModelInstance(chatModel.md, llmProviders),
      lg: await this.modelResolverService.getModelInstance(chatModel.lg, llmProviders),
      ability: chatModel?.ability,
      isInstance,
      lgModelKey: chatModel.lg,
      mdModelKey: chatModel.md,
      smModelKey: chatModel.sm,
    };
  }

  // ── Capabilities ──────────────────────────────────────────────────────────

  getModelTags(modelKey: string, llmProviders: LLMProvider[]): Promise<GatewayModelTag[]> {
    return this.modelCapabilityService.getModelTags(modelKey, llmProviders);
  }

  findFirstVisionModel(llmProviders: LLMProvider[]) {
    return this.modelCapabilityService.findFirstVisionModel(llmProviders);
  }

  // ── Gateway models ────────────────────────────────────────────────────────

  fetchGatewayModelsFromApi() {
    return this.gatewayModelService.fetchGatewayModelsFromApi();
  }

  getGatewayModelConfig(modelId: string) {
    return this.gatewayModelService.getGatewayModelConfig(modelId);
  }

  getGatewayModelPricing(modelId: string) {
    return this.gatewayModelService.getGatewayModelPricing(modelId);
  }

  // ── Generation ────────────────────────────────────────────────────────────

  generateStream(baseId: string, aiGenerateRo: IAiGenerateRo, response: Response): Promise<void> {
    return this.generationService.generateStream(baseId, aiGenerateRo, response);
  }

  generateText(baseId: string, aiGenerateRo: IAiGenerateRo): Promise<string> {
    return this.generationService.generateText(baseId, aiGenerateRo);
  }

  // ── Mastra threads ────────────────────────────────────────────────────────

  createThread(resourceId: string, agentId: string, title?: string): Promise<IMastraThread> {
    return this.mastraClientService.createThread(resourceId, agentId, title);
  }

  getThread(threadId: string, agentId?: string): Promise<IMastraThread | null> {
    return this.mastraClientService.getThread(threadId, agentId);
  }

  getThreadMessages(
    threadId: string,
    agentId: string
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    return this.mastraClientService.getThreadMessages(threadId, agentId);
  }

  deleteThread(threadId: string, agentId?: string): Promise<void> {
    return this.mastraClientService.deleteThread(threadId, agentId);
  }

  listThreads(resourceId: string): Promise<IMastraThread[]> {
    return this.mastraClientService.listThreads(resourceId);
  }

  // ── TTS ───────────────────────────────────────────────────────────────────

  tts(text: string, response: Response): Promise<void> {
    return this.ttsService.tts(text, response);
  }
}
