/* eslint-disable @typescript-eslint/naming-convention, sonarjs/no-duplicate-string */
import type { IAIConfig, LLMProvider } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import {
  assignProviderIds,
  applyAiConfigPatch,
  maskAiConfig,
  migrateAiConfig,
  relabelProviders,
} from './provider-config';
import type { IKeyCrypto, IKeyPreview } from './provider-config';

const GATEWAY = 'vercel-gateway';
// Reversible stand-in for the real cipher: enough to see what was encrypted and with which id.
const crypto: IKeyCrypto = {
  encrypt: (id, plain) => `v1:${id}:t:${plain}`,
  isEncrypted: (v) => typeof v === 'string' && v.startsWith('v1:'),
};
const previewer: IKeyPreview = {
  preview: (p) => (p.apiKey ? `pre(${p.id})` : undefined),
  gatewayPreview: () => 'pre(gw)',
};

const provider = (over: Partial<LLMProvider>): LLMProvider => ({
  type: LLMProviderType.OPENAI_COMPATIBLE,
  name: 'teable',
  models: 'm1',
  ...over,
});

describe('assignProviderIds', () => {
  it('derives unique ids from the type and keeps existing ones', () => {
    const { providers, changed } = assignProviderIds([
      provider({ baseUrl: 'http://a/v1' }),
      provider({ baseUrl: 'http://b/v1' }),
      provider({ id: 'mine', type: LLMProviderType.OPENAI }),
    ]);
    expect(providers.map((p) => p.id)).toEqual(['openaicompatible', 'openaicompatible-2', 'mine']);
    expect(changed).toBe(true);
  });

  it('replaces duplicate or invalid ids', () => {
    const { providers } = assignProviderIds([
      provider({ id: 'x' }),
      provider({ id: 'x' }),
      provider({ id: 'teable' }),
    ]);
    expect(new Set(providers.map((p) => p.id)).size).toBe(3);
    expect(providers.map((p) => p.id)).not.toContain('teable');
  });
});

describe('relabelProviders', () => {
  it('replaces the legacy name with unique type labels and keeps real names', () => {
    const { providers, changed } = relabelProviders([
      provider({ id: 'a' }),
      provider({ id: 'b', name: '' }),
      provider({ id: 'c', name: 'vLLM (gpu-01)' }),
      provider({ id: 'd', type: LLMProviderType.OPENAI }),
    ]);
    expect(changed).toBe(true);
    expect(providers.map((p) => p.name)).toEqual([
      'OpenAI-compatible',
      'OpenAI-compatible 2',
      'vLLM (gpu-01)',
      'OpenAI',
    ]);
    expect(relabelProviders(providers).changed).toBe(false);
  });
});

describe('migrateAiConfig', () => {
  const legacy: IAIConfig = {
    llmProviders: [provider({ apiKey: 'sk-plain', baseUrl: 'http://a/v1' })],
    aiGatewayApiKey: 'gw-plain',
  };

  it('assigns ids and encrypts every plain key', () => {
    const { aiConfig, changed } = migrateAiConfig(legacy, crypto, GATEWAY);
    expect(changed).toBe(true);
    expect(aiConfig.llmProviders[0].apiKey).toBe('v1:openaicompatible:t:sk-plain');
    expect(aiConfig.aiGatewayApiKey).toBe(`v1:${GATEWAY}:t:gw-plain`);
  });

  it('is idempotent', () => {
    const once = migrateAiConfig(legacy, crypto, GATEWAY).aiConfig;
    const twice = migrateAiConfig(once, crypto, GATEWAY);
    expect(twice.changed).toBe(false);
    expect(twice.aiConfig).toEqual(once);
  });

  it('leaves providers without keys alone', () => {
    const { aiConfig } = migrateAiConfig(
      { llmProviders: [provider({ id: 'ollama', apiKeyEnv: 'OLLAMA_KEY' })] },
      crypto,
      GATEWAY
    );
    expect(aiConfig.llmProviders[0].apiKey).toBeUndefined();
  });
});

describe('applyAiConfigPatch', () => {
  const stored: IAIConfig = {
    llmProviders: [provider({ id: 'vllm', apiKey: 'v1:vllm:t:old', baseUrl: 'http://gpu/v1' })],
    aiGatewayApiKey: 'v1:gw:t:gw-old',
    aiGatewayBaseUrl: 'https://gw.example',
    aiGatewayApiKeys: ['k1', 'k2'],
    chatModel: { lg: 'a@b@vllm' },
  };

  it('keeps stored providers and Gateway key fields whatever the request says', () => {
    const merged = applyAiConfigPatch(stored, {
      llmProviders: [],
      aiGatewayApiKey: 'gw-forged',
      aiGatewayBaseUrl: 'https://evil.example',
      chatModel: { lg: 'x@y@vllm' },
    });
    expect(merged.llmProviders).toEqual(stored.llmProviders);
    expect(merged.aiGatewayApiKey).toBe('v1:gw:t:gw-old');
    expect(merged.aiGatewayBaseUrl).toBe('https://gw.example');
    expect(merged.aiGatewayApiKeys).toEqual(['k1', 'k2']);
    expect(merged.chatModel).toEqual({ lg: 'x@y@vllm' });
  });

  it('drops the masked read-only fields', () => {
    const merged = applyAiConfigPatch(stored, {
      llmProviders: [],
      aiGatewayApiKeyPreview: 'y',
      aiGatewayApiKeyCount: 2,
      hasVertexByokCredential: true,
    } as unknown as IAIConfig);
    expect(merged).not.toHaveProperty('aiGatewayApiKeyPreview');
    expect(merged).not.toHaveProperty('aiGatewayApiKeyCount');
    expect(merged).not.toHaveProperty('hasVertexByokCredential');
  });

  it('starts empty when nothing is stored', () => {
    expect(applyAiConfigPatch(null, { llmProviders: [] })).toMatchObject({
      llmProviders: [],
      aiGatewayApiKey: null,
    });
  });
});

describe('maskAiConfig', () => {
  it('returns no keys', () => {
    const masked = maskAiConfig(
      {
        llmProviders: [provider({ id: 'vllm', apiKey: 'v1:vllm:t:sk' }), provider({ id: 'o' })],
        aiGatewayApiKey: 'v1:gw:t:gw',
        aiGatewayApiKeys: ['a'],
        vertexByokCredential: {
          project: 'p',
          location: 'l',
          googleCredentials: { privateKey: 'pk', clientEmail: 'e' },
        },
      },
      previewer
    );
    const json = JSON.stringify(masked);
    expect(json).not.toContain('sk');
    expect(json).not.toContain('v1:');
    expect(json).not.toContain('pk');
    expect(masked.llmProviders[0]).toMatchObject({ hasApiKey: true, apiKeyPreview: 'pre(vllm)' });
    expect(masked.llmProviders[1]).toMatchObject({ hasApiKey: false });
    expect(masked).toMatchObject({
      aiGatewayApiKeyPreview: 'pre(gw)',
      aiGatewayApiKeyCount: 1,
      hasVertexByokCredential: true,
    });
  });
});
