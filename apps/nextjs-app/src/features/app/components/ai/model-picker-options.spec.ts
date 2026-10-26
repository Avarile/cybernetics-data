/* eslint-disable sonarjs/no-duplicate-string */
import type { IAiProviderVo } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { buildPickerGroups, disabledReason, resolvePickerValue } from './model-picker-options';

const compat = LLMProviderType.OPENAI_COMPATIBLE;
const vo = (over: Partial<IAiProviderVo>): IAiProviderVo => ({
  id: 'x',
  type: compat,
  name: 'X',
  models: '',
  hasApiKey: false,
  keySource: 'none',
  status: 'ready',
  modelCount: 0,
  usedBy: [],
  version: 1,
  ...over,
});

const providers = [
  vo({
    id: 'ollama-local',
    name: 'Ollama',
    models: 'llama3.3,qwen3',
    modelConfigs: { qwen3: { tags: ['tool-use'], label: 'Qwen 3' } },
  }),
  vo({ id: 'vllm-gpu01', name: 'vLLM', models: 'qwen3', status: 'error' }),
  vo({ id: 'off', name: 'Off', models: 'm', enabled: false }),
  vo({ id: 'vercel-gateway', type: LLMProviderType.AI_GATEWAY, name: 'Gateway' }),
];
const gateway = [
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet', enabled: true, tags: ['tool-use'] },
  { id: 'openai/gpt-5', label: '', enabled: false },
] as never;

describe('buildPickerGroups', () => {
  it('groups models by provider with id-based keys and skips disabled providers', () => {
    const groups = buildPickerGroups(providers, gateway);
    expect(groups.map((g) => g.providerId)).toEqual([
      'ollama-local',
      'vllm-gpu01',
      'vercel-gateway',
    ]);
    expect(groups[0].options.map((o) => o.key)).toEqual([
      `${compat}@llama3.3@ollama-local`,
      `${compat}@qwen3@ollama-local`,
    ]);
    expect(groups[0].options[1]).toMatchObject({ label: 'Qwen 3', tags: ['tool-use'] });
    expect(groups[1].options[0].providerStatus).toBe('error');
    expect(groups[2].options.map((o) => o.key)).toEqual([
      'aiGateway@anthropic/claude-sonnet-4.5@teable',
    ]);
  });
});

describe('disabledReason', () => {
  it('explains a missing capability', () => {
    const [ollama] = buildPickerGroups(providers, gateway);
    expect(disabledReason(ollama.options[0], ['tool-use'])).toBe('needs tool-use');
    expect(disabledReason(ollama.options[1], ['tool-use'])).toBeUndefined();
    expect(disabledReason(ollama.options[0])).toBeUndefined();
  });
});

describe('resolvePickerValue', () => {
  const groups = buildPickerGroups(providers, gateway);

  it('finds exact keys', () => {
    expect(resolvePickerValue(`${compat}@qwen3@vllm-gpu01`, groups)?.providerId).toBe('vllm-gpu01');
  });

  it('shows legacy @teable keys as their provider option', () => {
    expect(resolvePickerValue(`${compat}@llama3.3@teable`, groups)?.key).toBe(
      `${compat}@llama3.3@ollama-local`
    );
  });

  it('returns nothing for unknown keys', () => {
    expect(resolvePickerValue(`${compat}@nope@teable`, groups)).toBeUndefined();
    expect(resolvePickerValue(undefined, groups)).toBeUndefined();
  });
});
