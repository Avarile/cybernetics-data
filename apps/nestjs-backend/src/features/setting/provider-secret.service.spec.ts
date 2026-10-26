/* eslint-disable @typescript-eslint/naming-convention */
import { randomBytes } from 'crypto';
import { LLMProviderType } from '@teable/openapi';
import { GATEWAY_PROVIDER_ID, ProviderSecretService } from './provider-secret.service';

const make = (envPattern = '^(OPENROUTER|VLLM)_[A-Z0-9_]+$') =>
  new ProviderSecretService(
    { encryptionKey: randomBytes(32).toString('base64') },
    { secretKey: 'unused' } as never,
    { envPattern }
  );

const provider = { type: LLMProviderType.OPENAI_COMPATIBLE, name: 'x', models: 'm' };

describe('ProviderSecretService', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves a stored key bound to its provider id', () => {
    const svc = make();
    const apiKey = svc.encryptKey('vllm', 'sk-1');
    expect(svc.resolveKey({ ...provider, id: 'vllm', apiKey })).toBe('sk-1');
    expect(() => svc.resolveKey({ ...provider, id: 'other', apiKey })).toThrow();
  });

  it('passes legacy plain keys through', () => {
    expect(make().resolveKey({ ...provider, apiKey: 'sk-plain' })).toBe('sk-plain');
  });

  it('reads allowed env vars and refuses the rest', () => {
    process.env.VLLM_API_KEY = 'from-env';
    process.env.SECRET_KEY = 'server-secret';
    const svc = make('.*');
    expect(svc.resolveKey({ ...provider, id: 'v', apiKeyEnv: 'VLLM_API_KEY' })).toBe('from-env');
    expect(svc.resolveKey({ ...provider, id: 'v', apiKeyEnv: 'SECRET_KEY' })).toBeUndefined();
  });

  it('reports env status without the value', () => {
    process.env.OPENROUTER_KEY = 'x';
    const svc = make();
    expect(svc.envStatus('OPENROUTER_KEY')).toEqual({ allowed: true, set: true });
    expect(svc.envStatus('OPENROUTER_OTHER')).toEqual({ allowed: true, set: false });
    expect(svc.envStatus('HOME')).toEqual({ allowed: false, set: false });
  });

  it('resolves header env references and drops refused ones', () => {
    process.env.OPENROUTER_REFERER = 'https://app.example';
    const svc = make();
    expect(
      svc.resolveHeaders({
        headers: {
          'X-Title': 'Cybernetics',
          'HTTP-Referer': 'env:OPENROUTER_REFERER',
          'X-Leak': 'env:PRISMA_DATABASE_URL',
        },
      })
    ).toEqual({ 'X-Title': 'Cybernetics', 'HTTP-Referer': 'https://app.example' });
  });

  it('encrypts and previews the Gateway key', () => {
    const svc = make();
    const aiGatewayApiKey = svc.encryptKey(GATEWAY_PROVIDER_ID, 'vck_0123456789abcd');
    expect(svc.resolveGatewayKey({ aiGatewayApiKey })).toBe('vck_0123456789abcd');
    expect(svc.gatewayPreview({ aiGatewayApiKey })).toBe('vck_…abcd');
  });

  it('describes key sources', () => {
    const svc = make();
    expect(svc.keySource({ apiKey: 'v1:x' })).toBe('stored');
    expect(svc.keySource({ apiKeyEnv: 'VLLM_KEY' })).toBe('env');
    expect(svc.keySource({})).toBe('none');
  });
});
