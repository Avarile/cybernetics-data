/* eslint-disable sonarjs/no-duplicate-string */
import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { IntegrationType, SettingKey } from '@teable/openapi';
import type { IAIConfig, IGetAIConfig, LLMProvider } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { PerformanceCache, PerformanceCacheService } from '../../../performance-cache';
import { SettingService } from '../../setting/setting.service';

@Injectable()
export class AiConfigService {
  constructor(
    private readonly settingService: SettingService,
    private readonly prismaService: PrismaService,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  // eslint-disable-next-line sonarjs/cognitive-complexity
  @PerformanceCache({ ttl: 30 })
  async getAIConfig(baseId: string): Promise<IGetAIConfig> {
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
    });
    const aiIntegration = await this.prismaService.integration.findFirst({
      where: { resourceId: spaceId, type: IntegrationType.AI, enable: true },
    });

    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    const { aiConfig } = await this.settingService.getSetting();

    const hasInstanceAIConfig =
      aiConfig &&
      (aiConfig.enable ||
        aiConfig.chatModel?.lg ||
        aiConfig.llmProviders?.length > 0 ||
        aiConfig.aiGatewayApiKey);
    if (!aiIntegrationConfig && !hasInstanceAIConfig) {
      throw new CustomHttpException('AI configuration is not set', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.ai.configurationNotSet',
        },
      });
    }

    let config: IAIConfig;

    if (!aiIntegrationConfig) {
      const lg = aiConfig?.chatModel?.lg;
      const sm = aiConfig?.chatModel?.sm;
      const md = aiConfig?.chatModel?.md;
      const ability = aiConfig?.chatModel?.ability;

      config = {
        ...aiConfig,
        llmProviders: aiConfig?.llmProviders.map((provider) => ({
          ...provider,
          isInstance: true,
        })),
        chatModel: {
          sm: sm || lg,
          md: md || lg,
          lg: lg,
          ability,
        },
      } as IAIConfig;
    } else if (!aiConfig?.chatModel?.lg) {
      config = aiIntegrationConfig as IAIConfig;
    } else {
      const lg = aiConfig.chatModel.lg;
      const sm = aiConfig.chatModel.sm;
      const md = aiConfig.chatModel.md;
      const ability = aiConfig.chatModel.ability;
      const spaceProviders = aiIntegrationConfig.llmProviders as LLMProvider[];
      const instanceProviders = aiConfig.llmProviders.map((provider) => ({
        ...provider,
        isInstance: true,
      }));
      const spaceKeys = new Set(spaceProviders.map((p) => `${p.type}:${p.name}`));
      config = {
        ...aiIntegrationConfig,
        // Include gateway models from admin config (space config doesn't have gateway models)
        gatewayModels: aiConfig.gatewayModels,
        // Space config wins on name collision; instance providers fill gaps only.
        llmProviders: [
          ...spaceProviders,
          ...instanceProviders.filter((p) => !spaceKeys.has(`${p.type}:${p.name}`)),
        ],
        chatModel: {
          sm: sm || lg,
          md: md || lg,
          lg: lg,
          ability,
        },
      } as IAIConfig;
    }

    return config as IGetAIConfig;
  }

  async getAIDisableAIActions(baseId: string) {
    const { spaceId } = await this.prismaService.base.findUniqueOrThrow({
      where: { id: baseId },
      select: { spaceId: true },
    });
    const aiIntegration = await this.prismaService.integration.findUnique({
      where: { resourceId: spaceId, type: IntegrationType.AI },
    });

    const aiIntegrationConfig = aiIntegration?.config ? JSON.parse(aiIntegration.config) : null;
    const disableAIActionsFromSpaceIntegration =
      aiIntegrationConfig?.capabilities?.disableActions ?? [];

    const { aiConfig } = await this.settingService.getSetting();
    const disableAIActionsFromInstanceAiSetting = aiConfig?.capabilities?.disableActions ?? [];

    const merged = [
      ...disableAIActionsFromInstanceAiSetting,
      ...disableAIActionsFromSpaceIntegration,
    ];
    return {
      disableActions: [...new Set(merged)],
    };
  }

  async getSimplifiedAIConfig(baseId: string) {
    try {
      const config = await this.getAIConfig(baseId);
      return {
        ...config,
        llmProviders: config.llmProviders.map(
          ({ type, name, models, isInstance, modelConfigs }) => ({
            type,
            name,
            models,
            isInstance,
            modelConfigs,
          })
        ),
      };
    } catch {
      return null;
    }
  }

  async getInstanceAIConfig(isCloud: boolean) {
    if (!isCloud) return null;

    const { aiConfig } = await this.settingService.getSetting();

    if (!aiConfig?.chatModel?.lg) return null;

    return aiConfig;
  }

  async getAttachmentTransferMode(): Promise<'url' | 'base64'> {
    const { aiConfig } = await this.settingService.getSetting([SettingKey.AI_CONFIG]);
    return aiConfig?.attachmentTransferMode || 'url';
  }
}
