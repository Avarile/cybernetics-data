import { describe, expect, it } from 'vitest';
import {
  buildModelKey,
  findProviderForModelKey,
  parseModelKey,
  providerListsModelKey,
} from './provider-match';
import type { LLMProvider } from './update';
import { LLMProviderType } from './update';

const compat = LLMProviderType.OPENAI_COMPATIBLE;
const p = (over: Partial<LLMProvider>): LLMProvider => ({
  type: compat,
  name: 'teable',
  models: '',
  isInstance: true,
  ...over,
});

const ollama = p({ id: 'ollama-local', name: 'Ollama', models: 'llama3.3,qwen3' });
const vllm = p({ id: 'vllm-gpu01', name: 'vLLM', models: 'qwen3-32b' });
const byok = p({ name: 'my-space-key', models: 'gpt-4.1', isInstance: undefined });

describe('findProviderForModelKey', () => {
  it('tells two providers of the same type apart by id', () => {
    expect(findProviderForModelKey(`${compat}@qwen3@ollama-local`, [ollama, vllm])).toBe(ollama);
    expect(findProviderForModelKey(`${compat}@qwen3-32b@vllm-gpu01`, [ollama, vllm])).toBe(vllm);
  });

  it('resolves legacy @teable keys to the instance provider listing the model', () => {
    expect(findProviderForModelKey(`${compat}@qwen3-32b@teable`, [ollama, vllm])).toBe(vllm);
    expect(findProviderForModelKey(`${compat}@unknown@teable`, [ollama, vllm])).toBe(ollama);
  });

  it('prefers flagged instance providers for the legacy alias', () => {
    expect(findProviderForModelKey(`${compat}@gpt-4.1@teable`, [byok, ollama])).toBe(ollama);
  });

  it('matches space BYOK providers by name', () => {
    expect(findProviderForModelKey(`${compat}@gpt-4.1@my-space-key`, [ollama, byok])).toBe(byok);
  });

  it('ignores other types and disabled providers', () => {
    expect(findProviderForModelKey(`openai@qwen3@ollama-local`, [ollama])).toBeUndefined();
    expect(
      findProviderForModelKey(`${compat}@qwen3@ollama-local`, [{ ...ollama, enabled: false }])
    ).toBeUndefined();
  });

  it('checks the model is listed', () => {
    expect(providerListsModelKey(`${compat}@qwen3@ollama-local`, [ollama])).toBe(true);
    expect(providerListsModelKey(`${compat}@gpt-5@ollama-local`, [ollama])).toBe(false);
  });
});

describe('model keys', () => {
  it('parses and builds', () => {
    expect(parseModelKey('aiGateway@anthropic/claude-sonnet-4.5@teable')).toEqual({
      type: 'aiGateway',
      model: 'anthropic/claude-sonnet-4.5',
      ref: 'teable',
    });
    expect(buildModelKey(vllm, 'qwen3-32b')).toBe(`${compat}@qwen3-32b@vllm-gpu01`);
    expect(buildModelKey(byok, 'gpt-4.1')).toBe(`${compat}@gpt-4.1@my-space-key`);
  });
});
