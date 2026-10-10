/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { AiDataContextService } from './ai-data-context.service';

const makeCache = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    setDetail: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => store.get(key)),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
};

const config = {
  contextSecret: 's'.repeat(48),
  serviceKey: 'mastra-key',
  contextTtlSeconds: 180,
};

const build = (overrides: Partial<typeof config> = {}) => {
  const cache = makeCache();
  const service = new AiDataContextService({ ...config, ...overrides } as any, cache as any);
  return { service, cache };
};

describe('AiDataContextService', () => {
  it('is enabled only when both the secret and the service key are set', () => {
    expect(build().service.enabled).toBe(true);
    expect(build({ contextSecret: undefined }).service.enabled).toBe(false);
    expect(build({ serviceKey: undefined }).service.enabled).toBe(false);
  });

  it('issues a context that checks out while it is live', async () => {
    const { service, cache } = build();
    const { token, requestId } = await service.issue('usr1', 'bse1');

    expect(cache.setDetail).toHaveBeenCalledWith(`ai-data:context:${requestId}`, true, 180);
    const result = await service.check(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toMatchObject({ userId: 'usr1', baseId: 'bse1', requestId });
    }
  });

  it('rejects a context replayed after it was revoked', async () => {
    const { service } = build();
    const { token, requestId } = await service.issue('usr1', 'bse1');
    await service.revoke(requestId);
    expect(await service.check(token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects a context that was never issued here, even if correctly signed elsewhere', async () => {
    const { service: issuer } = build();
    const { service: other } = build();
    const { token } = await issuer.issue('usr1', 'bse1');
    // Same secret, but this replica's cache never saw the request id.
    expect(await other.check(token)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rejects everything when disabled', async () => {
    const { service } = build();
    const { token } = await service.issue('usr1', 'bse1');
    const disabled = new AiDataContextService(
      { ...config, serviceKey: undefined } as any,
      makeCache() as any
    );
    expect(await disabled.check(token)).toEqual({ ok: false, reason: 'disabled' });
  });

  it('refuses to issue without a secret', async () => {
    const { service } = build({ contextSecret: undefined });
    await expect(service.issue('usr1', 'bse1')).rejects.toThrow(/AI_DATA_CONTEXT_SECRET/);
  });
});
