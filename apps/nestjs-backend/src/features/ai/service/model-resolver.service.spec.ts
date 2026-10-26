/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import { randomBytes } from 'crypto';
import type { LLMProvider } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { ProviderSecretService } from '../../setting/provider-secret.service';
import { ModelResolverService } from './model-resolver.service';

const compat = LLMProviderType.OPENAI_COMPATIBLE;

describe('ModelResolverService', () => {
  const originalEnv = process.env;
  const secrets = new ProviderSecretService(
    { encryptionKey: randomBytes(32).toString('base64') },
    { secretKey: 'unused' } as never,
    { envPattern: '^(VLLM|OLLAMA)_[A-Z0-9_]+$' }
  );
  const settingService = { getSetting: vi.fn(async () => ({ aiConfig: {} })) };
  const resolver = new ModelResolverService(settingService as never, secrets);

  const providers: LLMProvider[] = [
    {
      id: 'ollama-local',
      type: compat,
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      models: 'qwen3',
      isInstance: true,
    },
    {
      id: 'vllm-gpu01',
      type: compat,
      name: 'vLLM',
      baseUrl: 'http://gpu01:8000/v1',
      models: 'qwen3',
      apiKey: secrets.encryptKey('vllm-gpu01', 'sk-vllm'),
      headers: { 'X-Team': 'data', 'X-Env-Header': 'env:VLLM_TEAM' },
      isInstance: true,
    },
    {
      id: 'env-keyed',
      type: LLMProviderType.OPENAI,
      name: 'OpenAI via env',
      baseUrl: 'https://api.openai.com/v1',
      models: 'gpt-4.1',
      apiKeyEnv: 'VLLM_OPENAI_KEY',
      isInstance: true,
    },
  ];

  beforeEach(() => {
    process.env = { ...originalEnv, VLLM_TEAM: 'from-env' };
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves two OpenAI-compatible providers with the same model separately', async () => {
    const ollama = await resolver.getModelConfig(`${compat}@qwen3@ollama-local`, providers);
    const vllm = await resolver.getModelConfig(`${compat}@qwen3@vllm-gpu01`, providers);
    expect(ollama).toMatchObject({ baseUrl: 'http://localhost:11434/v1', apiKey: undefined });
    expect(vllm).toMatchObject({ baseUrl: 'http://gpu01:8000/v1', apiKey: 'sk-vllm' });
  });

  it('passes provider headers with env references resolved', async () => {
    const vllm = await resolver.getModelConfig(`${compat}@qwen3@vllm-gpu01`, providers);
    expect(vllm).toMatchObject({ headers: { 'X-Team': 'data', 'X-Env-Header': 'from-env' } });
  });

  it('still resolves legacy @teable keys', async () => {
    const legacy = await resolver.getModelConfig(`${compat}@qwen3@teable`, providers);
    expect(legacy).toMatchObject({ baseUrl: 'http://localhost:11434/v1' });
    expect(resolver.findModelInProviders(`${compat}@qwen3@teable`, providers)).toBe(true);
    expect(resolver.findModelInProviders(`${compat}@gpt-9@teable`, providers)).toBe(false);
  });

  it('reports an env-var key that is not set as not configured', async () => {
    await expect(
      resolver.getModelConfig(`${LLMProviderType.OPENAI}@gpt-4.1@env-keyed`, providers)
    ).rejects.toThrow(/VLLM_OPENAI_KEY, which is not set/);
    process.env.VLLM_OPENAI_KEY = 'sk-env';
    await expect(
      resolver.getModelConfig(`${LLMProviderType.OPENAI}@gpt-4.1@env-keyed`, providers)
    ).resolves.toMatchObject({ apiKey: 'sk-env' });
  });

  it('builds a model for a keyless OpenAI-compatible endpoint', async () => {
    await expect(
      resolver.getModelInstance(`${compat}@qwen3@ollama-local`, providers)
    ).resolves.toBeDefined();
  });

  it('fails clearly for an unknown provider', async () => {
    await expect(resolver.getModelConfig(`${compat}@qwen3@nope`, providers)).rejects.toThrow(
      /provider configuration is not set/
    );
  });
});
