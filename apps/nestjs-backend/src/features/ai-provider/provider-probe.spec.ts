/* eslint-disable @typescript-eslint/naming-convention */
import { LLMProviderType } from '@teable/openapi';
import axios from 'axios';
import { modelListRequest, probeHint, probeModels } from './provider-probe';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof axios }>();
  return { default: { ...actual.default, create: actual.default.create, get: vi.fn() } };
});

describe('provider probe', () => {
  it('lists OpenAI-compatible models with a bearer key and extra headers', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: { data: [{ id: 'qwen3' }, { id: 'llama3.3' }] },
    });
    const res = await probeModels({
      type: LLMProviderType.OPENAI_COMPATIBLE,
      baseUrl: 'http://gpu01:8000/v1/',
      apiKey: 'sk',
      headers: { 'X-Team': 'data' },
    });
    expect(res).toMatchObject({ ok: true, status: 200, models: ['qwen3', 'llama3.3'] });
    expect(vi.mocked(axios.get).mock.calls[0][0]).toBe('http://gpu01:8000/v1/models');
    expect(vi.mocked(axios.get).mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer sk', 'X-Team': 'data' },
    });
  });

  it("uses Ollama's native tag listing", () => {
    const req = modelListRequest({
      type: LLMProviderType.OLLAMA,
      baseUrl: 'http://host:11434/api',
    });
    expect(req.url).toBe('http://host:11434/api/tags');
    expect(req.pick({ models: [{ name: 'llama3.3' }] })).toEqual(['llama3.3']);
  });

  it('uses x-api-key for Anthropic-compatible endpoints', () => {
    const req = modelListRequest({
      type: LLMProviderType.ANTHROPIC_COMPATIBLE,
      baseUrl: 'https://proxy/v1',
      apiKey: 'sk-ant',
    });
    expect(req.headers).toMatchObject({ 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' });
    expect(req.headers).not.toHaveProperty('Authorization');
  });

  it('falls back to the well-known base URL', () => {
    expect(modelListRequest({ type: LLMProviderType.OPENROUTER }).url).toBe(
      'https://openrouter.ai/api/v1/models'
    );
  });

  it('turns failures into results with hints', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ status: 401, data: {} });
    expect(await probeModels({ type: LLMProviderType.OPENAI, apiKey: 'bad' })).toMatchObject({
      ok: false,
      status: 401,
      hint: 'The provider rejected the API key.',
    });

    vi.mocked(axios.get).mockRejectedValueOnce(
      Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
    );
    const res = await probeModels({
      type: LLMProviderType.OPENAI_COMPATIBLE,
      baseUrl: 'http://localhost:8000/v1',
    });
    expect(res.ok).toBe(false);
    expect(res.hint).toMatch(/host.docker.internal/);
  });

  it('requires a base URL for custom types', async () => {
    expect(await probeModels({ type: LLMProviderType.OPENAI_COMPATIBLE })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/base URL/),
    });
  });

  it('suggests /v1 on a 404', () => {
    expect(
      probeHint(
        { status: 404 },
        { type: LLMProviderType.OPENAI_COMPATIBLE, baseUrl: 'http://x:8000' }
      )
    ).toMatch(/\/v1/);
  });
});
