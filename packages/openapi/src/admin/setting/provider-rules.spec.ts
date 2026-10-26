import { describe, expect, it } from 'vitest';
import { aiProviderVoSchema } from './ai-provider';
import {
  checkProviderEnvName,
  isProviderIdAllowed,
  parseEnvRef,
  suggestProviderId,
} from './provider-rules';
import { LLMProviderType, llmProviderSchema } from './update';

describe('provider ids', () => {
  it('accepts slugs and rejects everything else', () => {
    expect(isProviderIdAllowed('openrouter')).toBe(true);
    expect(isProviderIdAllowed('vllm-gpu01')).toBe(true);
    expect(isProviderIdAllowed('Vllm')).toBe(false);
    expect(isProviderIdAllowed('-x')).toBe(false);
    expect(isProviderIdAllowed('a'.repeat(49))).toBe(false);
    expect(isProviderIdAllowed('has space')).toBe(false);
  });

  it('reserves the legacy teable alias', () => {
    expect(isProviderIdAllowed('teable')).toBe(false);
    expect(suggestProviderId('Teable')).toBe('teable-1');
  });

  it('suggests ids from display names', () => {
    expect(suggestProviderId('vLLM (gpu-01)')).toBe('vllm-gpu-01');
    expect(suggestProviderId('Ollama (local)')).toBe('ollama-local');
    expect(suggestProviderId('***')).toBe('provider');
  });
});

describe('provider env names', () => {
  it('allows provider-looking names', () => {
    expect(checkProviderEnvName('OPENROUTER_KEY')).toEqual({ ok: true });
    expect(checkProviderEnvName('AI_GATEWAY_API_KEY')).toEqual({ ok: true });
    expect(checkProviderEnvName('VLLM_API_KEY')).toEqual({ ok: true });
  });

  it('never allows the app secrets, even with a permissive pattern', () => {
    for (const name of [
      'SECRET_KEY',
      'BACKEND_SECRETS_ENCRYPTION_KEY',
      'PRISMA_DATABASE_URL',
      'VECTOR_DATABASE_URL',
      'MASTRA_API_KEY',
      'BACKEND_JWT_SECRET',
    ]) {
      expect(checkProviderEnvName(name, '.*')).toEqual({ ok: false, reason: 'denied' });
    }
  });

  it('refuses names outside the allow pattern', () => {
    expect(checkProviderEnvName('HOME')).toEqual({ ok: false, reason: 'not-allowed' });
    expect(checkProviderEnvName('MY_KEY', '^MY_')).toEqual({ ok: true });
  });

  it('refuses bad syntax', () => {
    expect(checkProviderEnvName('lower_case')).toEqual({ ok: false, reason: 'syntax' });
    expect(checkProviderEnvName('A')).toEqual({ ok: false, reason: 'syntax' });
  });

  it('parses env references in header values', () => {
    expect(parseEnvRef('env:OPENROUTER_REFERER')).toBe('OPENROUTER_REFERER');
    expect(parseEnvRef('https://example.com')).toBeUndefined();
  });
});

describe('llmProviderSchema', () => {
  const base = { type: LLMProviderType.OPENAI_COMPATIBLE, name: 'vLLM', models: 'qwen3' };

  it('still accepts configs saved before provider ids existed', () => {
    expect(llmProviderSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the registry fields', () => {
    const parsed = llmProviderSchema.safeParse({
      ...base,
      id: 'vllm-gpu01',
      apiKeyEnv: 'VLLM_API_KEY',
      headers: { 'X-Title': 'Cybernetics', 'HTTP-Referer': 'env:OPENROUTER_REFERER' },
      fetchModels: true,
      enabled: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects denied env vars and forbidden headers', () => {
    expect(llmProviderSchema.safeParse({ ...base, apiKeyEnv: 'SECRET_KEY' }).success).toBe(false);
    expect(llmProviderSchema.safeParse({ ...base, headers: { Host: 'evil' } }).success).toBe(false);
    expect(
      llmProviderSchema.safeParse({ ...base, headers: { 'X-Key': 'env:PRISMA_DATABASE_URL' } })
        .success
    ).toBe(false);
  });

  it('accepts the anthropic-compatible type', () => {
    expect(
      llmProviderSchema.safeParse({ ...base, type: LLMProviderType.ANTHROPIC_COMPATIBLE }).success
    ).toBe(true);
  });
});

describe('aiProviderVoSchema', () => {
  it('has no apiKey field', () => {
    const vo = aiProviderVoSchema.parse({
      id: 'openrouter',
      type: LLMProviderType.OPENROUTER,
      name: 'OpenRouter',
      models: '',
      apiKey: 'sk-should-be-stripped',
      hasApiKey: true,
      keySource: 'stored',
      apiKeyPreview: 'sk-or-…9f2c',
      status: 'ready',
      modelCount: 0,
      usedBy: [],
      version: 1,
    });
    expect('apiKey' in vo).toBe(false);
  });
});
