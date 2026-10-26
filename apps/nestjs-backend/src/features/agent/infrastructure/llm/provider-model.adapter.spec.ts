import { LLMProviderType } from '@teable/openapi';
import { modelKeyForRef, parseModelRef } from './provider-model.adapter';

const providers = [
  { id: 'vllm-gpu01', type: LLMProviderType.OPENAI_COMPATIBLE, name: 'vLLM', models: 'qwen3' },
  { id: 'off', type: LLMProviderType.OPENAI, name: 'Off', models: 'x', enabled: false },
];

describe('agent model refs', () => {
  it('parses providerId/model, keeping slashes in the model', () => {
    expect(parseModelRef('vercel-gateway/anthropic/claude-sonnet-4.5')).toEqual({
      providerId: 'vercel-gateway',
      model: 'anthropic/claude-sonnet-4.5',
    });
    expect(() => parseModelRef('no-slash')).toThrow(/providerId\/model/);
    expect(() => parseModelRef('trailing/')).toThrow();
  });

  it('builds model keys by provider id, and Gateway keys by type', () => {
    expect(modelKeyForRef('vllm-gpu01/qwen3', providers)).toBe('openaiCompatible@qwen3@vllm-gpu01');
    expect(modelKeyForRef('vercel-gateway/openai/gpt-5', providers)).toBe(
      'aiGateway@openai/gpt-5@teable'
    );
  });

  it('refuses unknown or disabled providers', () => {
    expect(() => modelKeyForRef('nope/m', providers)).toThrow(/not configured/);
    expect(() => modelKeyForRef('off/x', providers)).toThrow(/disabled/);
  });
});
