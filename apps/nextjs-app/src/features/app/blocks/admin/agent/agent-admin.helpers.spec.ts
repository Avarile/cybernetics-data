/* eslint-disable sonarjs/no-duplicate-string */
import type { IAgentStatusVo } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import type { IPickerGroup } from '../../../components/ai/model-picker-options';
import { availableActions, keyToRef, refToKey, toggle } from './agent-admin.helpers';

const groups = [
  {
    providerId: 'vllm-gpu01',
    options: [
      { key: 'openaiCompatible@qwen3@vllm-gpu01', providerId: 'vllm-gpu01', model: 'qwen3' },
    ],
  },
  {
    providerId: 'vercel-gateway',
    options: [
      {
        key: 'aiGateway@openai/gpt-4.1@teable',
        providerId: 'vercel-gateway',
        model: 'openai/gpt-4.1',
      },
    ],
  },
] as unknown as IPickerGroup[];

const status = (over: Partial<IAgentStatusVo>) =>
  ({ enabled: true, status: 'ok', baseId: 'bse1', ...over }) as IAgentStatusVo;

describe('agent admin helpers', () => {
  it('maps picker keys and stored refs both ways, gateway ids included', () => {
    expect(keyToRef('openaiCompatible@qwen3@vllm-gpu01', groups)).toBe('vllm-gpu01/qwen3');
    expect(keyToRef('aiGateway@openai/gpt-4.1@teable', groups)).toBe(
      'vercel-gateway/openai/gpt-4.1'
    );
    expect(refToKey('vercel-gateway/openai/gpt-4.1', groups)).toBe(
      'aiGateway@openai/gpt-4.1@teable'
    );
    expect(refToKey('gone/model', groups)).toBeUndefined();
    expect(refToKey(null, groups)).toBeUndefined();
  });

  it('offers the lifecycle actions that fit the state', () => {
    expect(availableActions(undefined)).toEqual([]);
    expect(availableActions(status({ enabled: false }))).toEqual(['enable']);
    expect(availableActions(status({ status: 'needs_setup' }))).toEqual([
      'restore',
      'reset',
      'disable',
    ]);
    expect(availableActions(status({}))).toEqual(['verify', 'reset', 'disable']);
  });

  it('toggles values in a stable order', () => {
    const all = ['a', 'b', 'c'] as const;
    expect(toggle(['c'], 'a', true, all)).toEqual(['a', 'c']);
    expect(toggle(['a', 'c'], 'a', false, all)).toEqual(['c']);
  });
});
