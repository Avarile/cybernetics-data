/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiDataContextCacheKey, generateAiDataContextToken } from './ai-data-context';
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

const config = { serviceKey: 'mastra-key', contextTtlSeconds: 180 };

const build = (overrides: Partial<typeof config> = {}, cache = makeCache()) => {
  const service = new AiDataContextService({ ...config, ...overrides } as any, cache as any);
  return { service, cache };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('AiDataContextService', () => {
  it('is enabled only when the Mastra service key is set', () => {
    expect(build().service.enabled).toBe(true);
    expect(build({ serviceKey: undefined }).service.enabled).toBe(false);
  });

  it('stores who the token acts as under a hash of the token, with the TTL', async () => {
    const { service, cache } = build();
    const { token } = await service.issue('usr1', 'bse1');

    const key = aiDataContextCacheKey(token);
    expect(cache.setDetail).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ userId: 'usr1', baseId: 'bse1' }),
      180
    );
    expect([...cache.store.keys()].some((k) => k.includes(token))).toBe(false);
  });

  it('checks out while live and returns the stored user and base', async () => {
    const { service } = build();
    const { token } = await service.issue('usr1', 'bse1');
    const result = await service.check(token);
    expect(result).toMatchObject({ ok: true, claims: { userId: 'usr1', baseId: 'bse1' } });
  });

  it('rejects a token replayed after it was revoked', async () => {
    const { service } = build();
    const { token } = await service.issue('usr1', 'bse1');
    await service.revoke(token);
    expect(await service.check(token)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects a well-formed token that was never issued', async () => {
    const { service } = build();
    expect(await service.check(generateAiDataContextToken())).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects an expired context even if the cache still has it', async () => {
    const { service } = build();
    const { token } = await service.issue('usr1', 'bse1');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 181_000);
    expect(await service.check(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed tokens without touching the cache', async () => {
    const { service, cache } = build();
    for (const token of [undefined, '', 'x', 42, 'a'.repeat(100)]) {
      expect(await service.check(token)).toEqual({ ok: false, reason: 'malformed' });
    }
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('rejects everything when disabled', async () => {
    const cache = makeCache();
    const { service: issuer } = build({}, cache);
    const { token } = await issuer.issue('usr1', 'bse1');
    const { service: disabled } = build({ serviceKey: undefined }, cache);
    expect(await disabled.check(token)).toEqual({ ok: false, reason: 'disabled' });
  });
});
