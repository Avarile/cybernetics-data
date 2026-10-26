import type { IAiProviderVo } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { findPreset, PROVIDER_PRESETS } from './presets';
import {
  duplicateState,
  stateFromPreset,
  stateFromProvider,
  toCreateRo,
  toTestDraft,
  toUpdateRo,
  validateState,
  withName,
} from './provider-form';

const vo = (over: Partial<IAiProviderVo> = {}): IAiProviderVo => ({
  id: 'vllm-gpu01',
  type: LLMProviderType.OPENAI_COMPATIBLE,
  name: 'vLLM',
  baseUrl: 'http://gpu01:8000/v1',
  models: 'qwen3,llama3.3',
  hasApiKey: true,
  keySource: 'stored',
  apiKeyPreview: 'sk-v…1234',
  status: 'ready',
  modelCount: 2,
  usedBy: [],
  version: 3,
  ...over,
});

describe('presets', () => {
  it('have unique keys and valid id hints', () => {
    const keys = PROVIDER_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PROVIDER_PRESETS) expect(p.idHint).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('start local presets without a key and avoid taken ids', () => {
    const state = stateFromPreset(findPreset('ollama')!, ['ollama-local']);
    expect(state).toMatchObject({ keyMode: 'none', id: 'ollama-local-2', fetchModels: true });
  });
});

describe('validateState', () => {
  const opts = { creating: true, takenIds: ['openrouter'] };

  it('requires a base URL for custom types and a key for keyed types', () => {
    const custom = stateFromPreset(findPreset('openai-compatible')!);
    expect(validateState({ ...custom, baseUrl: '' }, opts).baseUrl).toBe('required');
    const openai = stateFromPreset(findPreset('openai')!);
    expect(validateState(openai, opts).key).toBe('required');
    expect(validateState({ ...openai, apiKey: 'sk-1' }, opts)).toEqual({});
  });

  it('checks ids and env names', () => {
    const s = { ...stateFromPreset(findPreset('openrouter')!), apiKey: 'k' };
    expect(validateState(s, opts).id).toBe('taken');
    expect(validateState({ ...s, id: 'teable' }, opts).id).toBe('invalid');
    expect(
      validateState({ ...s, id: 'ok', keyMode: 'env', apiKeyEnv: 'SECRET_KEY' }, opts).key
    ).toBe('env');
    expect(
      validateState({ ...s, id: 'ok', keyMode: 'env', apiKeyEnv: 'OPENROUTER_KEY' }, opts)
    ).toEqual({});
  });

  it('rejects duplicate header names', () => {
    const s = {
      ...stateFromPreset(findPreset('ollama')!),
      headers: [
        { name: 'X-A', value: '1' },
        { name: 'x-a', value: '2' },
      ],
    };
    expect(validateState(s, opts).headers).toBe('duplicate');
  });
});

describe('name and id', () => {
  it('lets the id follow the name until it is edited', () => {
    const s = stateFromPreset(findPreset('vllm')!);
    expect(withName(s, 'vLLM (gpu-01)').id).toBe('vllm-gpu-01');
    expect(withName({ ...s, idTouched: true, id: 'mine' }, 'Other').id).toBe('mine');
  });
});

describe('toCreateRo', () => {
  it('sends the pasted key once and nothing for keyless providers', () => {
    const s = { ...stateFromPreset(findPreset('openai')!), apiKey: ' sk-1 ', models: ['gpt-4.1'] };
    expect(toCreateRo(s)).toMatchObject({ id: 'openai', apiKey: 'sk-1', models: 'gpt-4.1' });
    const local = stateFromPreset(findPreset('ollama')!);
    expect(toCreateRo(local)).not.toHaveProperty('apiKey');
  });

  it('sends env references and headers', () => {
    const s = {
      ...stateFromPreset(findPreset('openrouter')!),
      keyMode: 'env' as const,
      apiKeyEnv: 'OPENROUTER_KEY',
      headers: [{ name: 'X-Title', value: 'Cybernetics' }],
    };
    expect(toCreateRo(s)).toMatchObject({
      apiKeyEnv: 'OPENROUTER_KEY',
      headers: { 'X-Title': 'Cybernetics' },
    });
    expect(toCreateRo(s)).not.toHaveProperty('apiKey');
  });
});

describe('toUpdateRo', () => {
  it('never re-sends the stored key', () => {
    const s = stateFromProvider(vo());
    expect(toUpdateRo(s, vo())).toEqual({ version: 3 });
  });

  it('sends only changed fields', () => {
    const s = { ...stateFromProvider(vo()), name: 'vLLM 2', models: ['qwen3'] };
    expect(toUpdateRo(s, vo())).toEqual({ version: 3, name: 'vLLM 2', models: 'qwen3' });
  });

  it('replaces, removes or swaps the key source', () => {
    const base = stateFromProvider(vo());
    expect(toUpdateRo({ ...base, keyMode: 'paste', apiKey: 'sk-new' }, vo()).apiKey).toBe('sk-new');
    expect(toUpdateRo({ ...base, keyMode: 'none' }, vo()).apiKey).toBeNull();
    expect(toUpdateRo({ ...base, keyMode: 'env', apiKeyEnv: 'VLLM_KEY' }, vo())).toMatchObject({
      apiKey: null,
      apiKeyEnv: 'VLLM_KEY',
    });
    const envVo = vo({ hasApiKey: false, keySource: 'env', apiKeyEnv: 'VLLM_KEY' });
    expect(
      toUpdateRo({ ...stateFromProvider(envVo), keyMode: 'paste', apiKey: 'sk' }, envVo)
    ).toMatchObject({ apiKey: 'sk', apiKeyEnv: null });
  });

  it('clears the base URL with null', () => {
    const s = { ...stateFromProvider(vo()), baseUrl: '' };
    expect(toUpdateRo(s, vo()).baseUrl).toBeNull();
  });
});

describe('duplicate and test draft', () => {
  it('copies settings but never the key', () => {
    const copy = duplicateState(vo(), ['vllm-gpu01-copy']);
    expect(copy).toMatchObject({ id: 'vllm-gpu01-copy-2', keyMode: 'paste', apiKey: '' });
  });

  it('builds a test draft without unused fields', () => {
    const s = { ...stateFromProvider(vo()), keyMode: 'paste' as const, apiKey: 'sk-try' };
    expect(toTestDraft(s)).toEqual({
      type: LLMProviderType.OPENAI_COMPATIBLE,
      baseUrl: 'http://gpu01:8000/v1',
      apiKey: 'sk-try',
      models: 'qwen3,llama3.3',
    });
    expect(toTestDraft(stateFromProvider(vo()))).not.toHaveProperty('apiKey');
  });
});
