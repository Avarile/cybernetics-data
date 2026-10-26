/* eslint-disable sonarjs/no-duplicate-string */
import { randomBytes } from 'crypto';
import type { IAIConfig } from '@teable/openapi';
import { LLMProviderType, SettingKey } from '@teable/openapi';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from '../setting/provider-secret.service';
import { AiProviderService } from './ai-provider.service';
import { ProviderUsageRegistry } from './provider-usage';

const compat = LLMProviderType.OPENAI_COMPATIBLE;

describe('AiProviderService', () => {
  const originalEnv = process.env;
  const secrets = new ProviderSecretService(
    { encryptionKey: randomBytes(32).toString('base64') },
    { secretKey: 'unused' } as never,
    { envPattern: '^(VLLM|OPENROUTER)_[A-Z0-9_]+$' }
  );

  const setup = (initial: Partial<IAIConfig> = {}) => {
    let row: IAIConfig = { llmProviders: [], ...initial };
    const settingService = {
      getStoredSetting: vi.fn(async (name: string) => (name === SettingKey.AI_CONFIG ? row : null)),
      updateSetting: vi.fn(async ({ aiConfig }: { aiConfig: IAIConfig }) => {
        row = aiConfig;
        return { aiConfig };
      }),
    };
    const usage = new ProviderUsageRegistry();
    const service = new AiProviderService(settingService as never, secrets, usage, {
      envPattern: '^(VLLM|OPENROUTER)_[A-Z0-9_]+$',
    });
    return { service, usage, row: () => row };
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_GATEWAY_API_KEY;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates a provider with an encrypted key and returns it masked', async () => {
    const { service, row } = setup();
    const vo = await service.create({
      id: 'vllm-gpu01',
      type: compat,
      name: 'vLLM',
      baseUrl: 'http://gpu01:8000/v1',
      models: 'qwen3',
      apiKey: 'sk-vllm-secret-1234',
    });
    expect(JSON.stringify(vo)).not.toContain('sk-vllm-secret');
    expect(vo).toMatchObject({
      hasApiKey: true,
      keySource: 'stored',
      apiKeyPreview: 'sk-v…1234',
      status: 'untested',
      version: 1,
      modelCount: 1,
    });
    expect(row().llmProviders[0].apiKey).toMatch(/^v1:/);
    expect(secrets.resolveKey(row().llmProviders[0])).toBe('sk-vllm-secret-1234');
  });

  it('refuses a duplicate id', async () => {
    const { service } = setup();
    const ro = { id: 'x', type: compat, name: 'X', models: '' };
    await service.create(ro);
    await expect(service.create(ro)).rejects.toThrow(/already exists/);
  });

  it('rejects a stale version with 409 and keeps the key when none is sent', async () => {
    const { service, row } = setup();
    await service.create({ id: 'x', type: compat, name: 'X', models: 'm', apiKey: 'sk-1' });
    await expect(service.update('x', { version: 0, name: 'Y' })).rejects.toMatchObject({
      status: 409,
    });
    const vo = await service.update('x', { version: 1, name: 'Y' });
    expect(vo).toMatchObject({ name: 'Y', version: 2, hasApiKey: true });
    expect(secrets.resolveKey(row().llmProviders[0])).toBe('sk-1');
  });

  it('removes the key when sent as null', async () => {
    const { service } = setup();
    await service.create({ id: 'x', type: compat, name: 'X', models: '', apiKey: 'sk-1' });
    const vo = await service.update('x', { version: 1, apiKey: null });
    expect(vo).toMatchObject({ hasApiKey: false, keySource: 'none' });
  });

  it('shows env-keyed providers as not set until the variable exists', async () => {
    const { service } = setup();
    await service.create({
      id: 'v',
      type: LLMProviderType.OPENAI,
      name: 'V',
      models: '',
      apiKeyEnv: 'VLLM_KEY',
    });
    expect(await service.get('v')).toMatchObject({
      keySource: 'env',
      envSet: false,
      status: 'not-set',
    });
    process.env.VLLM_KEY = 'x';
    expect(await service.get('v')).toMatchObject({ envSet: true, status: 'untested' });
  });

  it('refuses env vars outside the server pattern', async () => {
    const { service } = setup();
    await expect(
      service.create({ id: 'v', type: compat, name: 'V', models: '', apiKeyEnv: 'GROQ_API_KEY' })
    ).rejects.toThrow(/not allowed/);
    expect(service.envStatus('SECRET_KEY')).toEqual({ allowed: false, set: false });
  });

  it('blocks deleting a provider in use and lists the users', async () => {
    const { service, usage } = setup({ chatModel: { lg: `${compat}@qwen3@vllm` } });
    await service.create({ id: 'vllm', type: compat, name: 'vLLM', models: 'qwen3' });
    usage.register(async () => [
      { kind: 'agent-model', label: 'Agent main model', modelKey: `${compat}@qwen3@vllm` },
    ]);
    expect((await service.get('vllm')).usedBy.map((u) => u.label)).toEqual([
      'Default chat model (lg)',
      'Agent main model',
    ]);
    await expect(service.delete('vllm')).rejects.toMatchObject({ status: 409 });
  });

  it('deletes an unused provider', async () => {
    const { service, row } = setup();
    await service.create({ id: 'x', type: compat, name: 'X', models: '' });
    await service.delete('x');
    expect(row().llmProviders).toEqual([]);
    await expect(service.delete('x')).rejects.toMatchObject({ status: 404 });
  });

  it('presents the Gateway as the vercel-gateway provider', async () => {
    const { service } = setup({
      aiGatewayApiKey: secrets.encryptKey(GATEWAY_PROVIDER_ID, 'vck_0123456789abcd'),
      gatewayModels: [
        { id: 'anthropic/claude-sonnet-4.5', enabled: true },
        { id: 'openai/gpt-5', enabled: false },
      ] as never,
    });
    const vo = await service.get(GATEWAY_PROVIDER_ID);
    expect(vo).toMatchObject({
      type: LLMProviderType.AI_GATEWAY,
      hasApiKey: true,
      apiKeyPreview: 'vck_…abcd',
      modelCount: 1,
      managedModels: true,
    });
  });

  it('updates the Gateway key through the provider route', async () => {
    const { service, row } = setup({
      aiGatewayApiKey: secrets.encryptKey(GATEWAY_PROVIDER_ID, 'old-key'),
    });
    await service.update(GATEWAY_PROVIDER_ID, { version: 0, apiKey: 'new-gateway-key' });
    expect(secrets.resolveGatewayKey(row())).toBe('new-gateway-key');
    await expect(
      service.update(GATEWAY_PROVIDER_ID, { version: 0, apiKey: 'x' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('shows an env-provided Gateway key without storing it', async () => {
    process.env.AI_GATEWAY_API_KEY = 'vck_env';
    const { service } = setup();
    expect(await service.get(GATEWAY_PROVIDER_ID)).toMatchObject({
      keySource: 'env',
      envSet: true,
      hasApiKey: false,
    });
  });

  it('records test results as health', async () => {
    const { service } = setup();
    await service.create({ id: 'x', type: compat, name: 'X', models: '' });
    await service.recordTest('x', false, 'HTTP 401');
    expect(await service.get('x')).toMatchObject({ status: 'error', lastError: 'HTTP 401' });
    await service.recordTest('x', true);
    expect((await service.get('x')).status).toBe('ready');
  });
});
