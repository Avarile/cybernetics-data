import { HttpErrorCode } from '@cybernetics/core';
import { Injectable } from '@nestjs/common';
import type {
  IAIConfig,
  IAiEnvStatusVo,
  IAiProviderListVo,
  IAiProviderVo,
  ICreateAiProviderRo,
  IUpdateAiProviderRo,
  LLMProvider,
} from '@teable/openapi';
import { checkProviderEnvName, LLMProviderType, parseEnvRef, SettingKey } from '@teable/openapi';
import { AiProviderConfig, type IAiProviderConfig } from '../../configs/ai-provider.config';
import { CustomHttpException } from '../../custom.exception';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from '../setting/provider-secret.service';
import { SettingService } from '../setting/setting.service';
import { aiConfigUsages, groupUsages, ProviderUsageRegistry } from './provider-usage';
import { gatewayAsProvider, toProviderVo } from './provider-view';
import type { IKeyFacts } from './provider-view';

const notFound = (id: string) =>
  new CustomHttpException(`AI provider "${id}" not found`, HttpErrorCode.NOT_FOUND);

/**
 * The instance LLM provider registry. Providers live in the aiConfig setting (keys encrypted); the
 * Vercel AI Gateway, stored in its own aiConfig fields, is presented as the provider
 * `vercel-gateway`. Every write bumps the provider's version; a stale version is a 409.
 */
@Injectable()
export class AiProviderService {
  constructor(
    private readonly settingService: SettingService,
    private readonly secrets: ProviderSecretService,
    private readonly usageRegistry: ProviderUsageRegistry,
    @AiProviderConfig() private readonly config: IAiProviderConfig
  ) {}

  async list(): Promise<IAiProviderListVo> {
    const aiConfig = await this.loadConfig();
    const providers = this.allProviders(aiConfig);
    const usages = groupUsages(await this.usages(aiConfig), providers);
    return {
      providers: providers.map((p) => this.toVo(p, usages.get(p.id!) ?? [])),
    };
  }

  async get(id: string): Promise<IAiProviderVo> {
    const vo = (await this.list()).providers.find((p) => p.id === id);
    if (!vo) throw notFound(id);
    return vo;
  }

  /** The stored provider with its key, for server-side use (tests, model listing). */
  async getStored(id: string): Promise<LLMProvider> {
    const provider = this.allProviders(await this.loadConfig()).find((p) => p.id === id);
    if (!provider) throw notFound(id);
    return provider;
  }

  async create(ro: ICreateAiProviderRo): Promise<IAiProviderVo> {
    this.assertEnvNames(ro);
    const aiConfig = await this.loadConfig();
    if (ro.id === GATEWAY_PROVIDER_ID || ro.type === LLMProviderType.AI_GATEWAY) {
      return this.saveGateway(aiConfig, { ...ro, version: 0 }, true);
    }
    if (this.allProviders(aiConfig).some((p) => p.id === ro.id)) {
      throw new CustomHttpException(
        `AI provider "${ro.id}" already exists`,
        HttpErrorCode.CONFLICT
      );
    }
    const { apiKey, ...rest } = ro;
    const provider: LLMProvider = {
      ...rest,
      ...(apiKey ? { apiKey: this.secrets.encryptKey(ro.id, apiKey) } : {}),
      version: 1,
    };
    await this.saveProviders(aiConfig, [...(aiConfig.llmProviders ?? []), provider]);
    return this.get(ro.id);
  }

  async update(id: string, ro: IUpdateAiProviderRo): Promise<IAiProviderVo> {
    this.assertEnvNames(ro);
    const aiConfig = await this.loadConfig();
    if (id === GATEWAY_PROVIDER_ID) return this.saveGateway(aiConfig, ro, false);

    const providers = aiConfig.llmProviders ?? [];
    const current = providers.find((p) => p.id === id);
    if (!current) throw notFound(id);
    this.assertVersion(current.version ?? 0, ro.version);

    const { apiKey, apiKeyEnv, baseUrl, version: _v, ...changes } = ro;
    const next: LLMProvider = { ...current, ...changes, id, version: (current.version ?? 0) + 1 };
    if (apiKeyEnv === null) delete next.apiKeyEnv;
    else if (apiKeyEnv) next.apiKeyEnv = apiKeyEnv;
    if (baseUrl === null) delete next.baseUrl;
    else if (baseUrl) next.baseUrl = baseUrl;
    if (apiKey === null) delete next.apiKey;
    else if (apiKey) next.apiKey = this.secrets.encryptKey(id, apiKey);
    // A changed endpoint or key invalidates the last test.
    if (apiKey !== undefined || baseUrl !== undefined || changes.type !== undefined) {
      delete next.lastTest;
    }
    await this.saveProviders(
      aiConfig,
      providers.map((p) => (p.id === id ? next : p))
    );
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const aiConfig = await this.loadConfig();
    const providers = this.allProviders(aiConfig);
    if (!providers.some((p) => p.id === id)) throw notFound(id);
    const usedBy = groupUsages(await this.usages(aiConfig), providers).get(id) ?? [];
    if (usedBy.length) {
      throw new CustomHttpException(
        `AI provider "${id}" is in use: ${usedBy.map((u) => u.label).join(', ')}`,
        HttpErrorCode.CONFLICT,
        { usedBy } as never
      );
    }
    if (id === GATEWAY_PROVIDER_ID) {
      await this.writeConfig({ ...aiConfig, aiGatewayApiKey: null, aiGatewayMeta: undefined });
      return;
    }
    await this.saveProviders(
      aiConfig,
      (aiConfig.llmProviders ?? []).filter((p) => p.id !== id)
    );
  }

  /** Record a connection test on the stored provider (drives its health chip). */
  async recordTest(id: string, ok: boolean, error?: string) {
    const aiConfig = await this.loadConfig();
    const lastTest = { ok, at: new Date().toISOString(), ...(error ? { error } : {}) };
    if (id === GATEWAY_PROVIDER_ID) {
      await this.writeConfig({
        ...aiConfig,
        aiGatewayMeta: { ...aiConfig.aiGatewayMeta, lastTest },
      });
      return;
    }
    await this.writeConfig({
      ...aiConfig,
      llmProviders: (aiConfig.llmProviders ?? []).map((p) =>
        p.id === id ? { ...p, lastTest } : p
      ),
    });
  }

  /** Store tested abilities and tags per model. */
  async recordModelConfigs(
    id: string,
    configs: Record<string, NonNullable<LLMProvider['modelConfigs']>[string]>
  ) {
    const aiConfig = await this.loadConfig();
    await this.writeConfig({
      ...aiConfig,
      llmProviders: (aiConfig.llmProviders ?? []).map((p) =>
        p.id === id ? { ...p, modelConfigs: { ...p.modelConfigs, ...configs } } : p
      ),
    });
  }

  envStatus(name: string): IAiEnvStatusVo {
    return this.secrets.envStatus(name);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async loadConfig(): Promise<IAIConfig> {
    const stored = await this.settingService.getStoredSetting<IAIConfig>(SettingKey.AI_CONFIG);
    return { ...stored, llmProviders: stored?.llmProviders ?? [] };
  }

  private async writeConfig(aiConfig: IAIConfig) {
    await this.settingService.updateSetting({ aiConfig });
  }

  private async saveProviders(aiConfig: IAIConfig, llmProviders: LLMProvider[]) {
    await this.writeConfig({ ...aiConfig, llmProviders });
  }

  private hasGateway(aiConfig: IAIConfig) {
    return Boolean(
      aiConfig.aiGatewayApiKey || process.env.AI_GATEWAY_API_KEY || aiConfig.gatewayModels?.length
    );
  }

  private allProviders(aiConfig: IAIConfig): LLMProvider[] {
    const providers = (aiConfig.llmProviders ?? []).filter((p) => p.id);
    return this.hasGateway(aiConfig)
      ? [...providers, gatewayAsProvider(aiConfig, aiConfig.aiGatewayMeta)]
      : providers;
  }

  private async usages(aiConfig: IAIConfig) {
    return [...aiConfigUsages(aiConfig), ...(await this.usageRegistry.collect())];
  }

  private keyFacts(provider: LLMProvider): IKeyFacts {
    if (provider.id === GATEWAY_PROVIDER_ID && !provider.apiKey) {
      const envSet = Boolean(process.env.AI_GATEWAY_API_KEY);
      return envSet
        ? { keySource: 'env', hasApiKey: false, envSet }
        : { keySource: 'none', hasApiKey: false };
    }
    const keySource = this.secrets.keySource(provider);
    if (keySource === 'stored') {
      const preview =
        provider.id === GATEWAY_PROVIDER_ID
          ? this.secrets.gatewayPreview({ aiGatewayApiKey: provider.apiKey })
          : this.secrets.preview(provider);
      return { keySource, hasApiKey: true, apiKeyPreview: preview };
    }
    if (keySource === 'env') {
      return {
        keySource,
        hasApiKey: false,
        envSet: this.secrets.envStatus(provider.apiKeyEnv!).set,
      };
    }
    return { keySource, hasApiKey: false };
  }

  private toVo(provider: LLMProvider, usedBy: IAiProviderVo['usedBy']): IAiProviderVo {
    const vo = toProviderVo(provider, this.keyFacts(provider), usedBy);
    return provider.id === GATEWAY_PROVIDER_ID ? { ...vo, managedModels: true } : vo;
  }

  private assertVersion(current: number, sent: number) {
    if (current !== sent) {
      throw new CustomHttpException(
        'This provider was changed by someone else. Reload and try again.',
        HttpErrorCode.CONFLICT
      );
    }
  }

  /** The server's env allow pattern applies on top of the schema's denylist. */
  private assertEnvNames(ro: { apiKeyEnv?: string | null; headers?: LLMProvider['headers'] }) {
    const names = [
      ...(ro.apiKeyEnv ? [ro.apiKeyEnv] : []),
      ...Object.values(ro.headers ?? {})
        .map(parseEnvRef)
        .filter((n): n is string => Boolean(n)),
    ];
    for (const name of names) {
      if (!checkProviderEnvName(name, this.config.envPattern).ok) {
        throw new CustomHttpException(
          `Env var ${name} is not allowed for provider keys (see AI_PROVIDER_ENV_PATTERN)`,
          HttpErrorCode.VALIDATION_ERROR
        );
      }
    }
  }

  private async saveGateway(
    aiConfig: IAIConfig,
    ro: { version: number; apiKey?: string | null; baseUrl?: string | null },
    creating: boolean
  ): Promise<IAiProviderVo> {
    const meta = aiConfig.aiGatewayMeta ?? {};
    if (creating && aiConfig.aiGatewayApiKey) {
      throw new CustomHttpException('The AI Gateway is already configured', HttpErrorCode.CONFLICT);
    }
    if (!creating) this.assertVersion(meta.version ?? 0, ro.version);
    const next: IAIConfig = {
      ...aiConfig,
      aiGatewayMeta: { version: (meta.version ?? 0) + 1 },
    };
    if (ro.apiKey === null) next.aiGatewayApiKey = null;
    else if (ro.apiKey)
      next.aiGatewayApiKey = this.secrets.encryptKey(GATEWAY_PROVIDER_ID, ro.apiKey);
    if (ro.baseUrl !== undefined) next.aiGatewayBaseUrl = ro.baseUrl || null;
    await this.writeConfig(next);
    return this.get(GATEWAY_PROVIDER_ID);
  }
}
