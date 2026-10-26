/* eslint-disable sonarjs/no-duplicate-string */
import { randomBytes } from 'crypto';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import type { IAIConfig, ISettingVo } from '@teable/openapi';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from '../provider-secret.service';
import { SettingOpenApiService } from './setting-open-api.service';

vi.mock('ai', () => ({
  createGateway: vi.fn(),
  generateImage: vi.fn(),
  generateText: vi.fn(),
  tool: vi.fn((config) => config),
}));

describe('SettingOpenApiService key masking', () => {
  const secrets = new ProviderSecretService(
    { encryptionKey: randomBytes(32).toString('base64') },
    { secretKey: 'unused' } as never,
    { envPattern: '.*' }
  );
  const stored: IAIConfig = {
    llmProviders: [
      {
        id: 'vllm',
        type: LLMProviderType.OPENAI_COMPATIBLE,
        name: 'teable',
        baseUrl: 'http://gpu/v1',
        models: 'qwen3',
        apiKey: secrets.encryptKey('vllm', 'sk-vllm-0123456789'),
      },
    ],
    aiGatewayApiKey: secrets.encryptKey(GATEWAY_PROVIDER_ID, 'vck_gateway_0123456789'),
  };

  const makeService = () => {
    let row: IAIConfig = stored;
    const settingService = {
      getSetting: vi.fn(async () => ({ aiConfig: row }) as ISettingVo),
      getStoredSetting: vi.fn(async (name: string) => (name === SettingKey.AI_CONFIG ? row : null)),
      updateSetting: vi.fn(async (ro: Partial<ISettingVo>) => {
        row = ro.aiConfig as IAIConfig;
        return { aiConfig: row } as ISettingVo;
      }),
    };
    const service = new SettingOpenApiService(
      undefined as never,
      undefined as never,
      { provider: 'local' } as never,
      undefined as never,
      undefined as never,
      settingService as never,
      undefined as never,
      secrets
    );
    return { service, settingService, current: () => row };
  };

  it('GET returns previews, never keys', async () => {
    const { service } = makeService();
    const setting = await service.getAdminSetting();
    const json = JSON.stringify(setting);
    expect(json).not.toContain('sk-vllm');
    expect(json).not.toContain('vck_gateway');
    expect(json).not.toContain('v1:');
    expect(setting.aiConfig?.llmProviders[0]).toMatchObject({
      hasApiKey: true,
      apiKeyPreview: 'sk-v…6789',
    });
    expect(setting.aiConfig?.aiGatewayApiKeyPreview).toBe('vck_g…6789');
  });

  it('PATCH with the masked config keeps the stored keys and returns no keys', async () => {
    const { service, current } = makeService();
    const masked = await service.getAdminSetting();
    const res = await service.updateSetting({
      aiConfig: { ...masked.aiConfig!, llmProviders: masked.aiConfig!.llmProviders },
    });
    expect(JSON.stringify(res)).not.toContain('v1:');
    expect(secrets.resolveKey(current().llmProviders[0])).toBe('sk-vllm-0123456789');
    expect(secrets.resolveGatewayKey(current())).toBe('vck_gateway_0123456789');
  });

  it('PATCH ignores providers and keys sent in the setting', async () => {
    const { service, current } = makeService();
    await service.updateSetting({
      aiConfig: {
        llmProviders: [{ ...stored.llmProviders[0], apiKey: 'sk-new-key-123' }],
        aiGatewayApiKey: 'forged',
      },
    });
    expect(secrets.resolveKey(current().llmProviders[0])).toBe('sk-vllm-0123456789');
    expect(secrets.resolveGatewayKey(current())).toBe('vck_gateway_0123456789');
  });
});
