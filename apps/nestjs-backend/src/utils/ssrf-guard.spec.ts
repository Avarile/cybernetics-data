import { describe, it, expect, afterEach } from 'vitest';
import { assertPublicHost, getSsrfSafeAgents, getSsrfSafeFetchAgent } from './ssrf-guard';

describe('getSsrfSafeAgents', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('should return both agents', () => {
    const agents = getSsrfSafeAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  it('should return empty object when SSRF protection is disabled', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSsrfSafeAgents()).toEqual({});
  });

  it('should return same cached object', () => {
    expect(getSsrfSafeAgents()).toBe(getSsrfSafeAgents());
  });
});

describe('getSsrfSafeFetchAgent', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it('picks the agent by protocol', () => {
    const select = getSsrfSafeFetchAgent();
    const { httpAgent, httpsAgent } = getSsrfSafeAgents();
    expect(select?.(new URL('http://example.com'))).toBe(httpAgent);
    expect(select?.(new URL('https://example.com'))).toBe(httpsAgent);
  });

  it('returns undefined when SSRF protection is disabled', () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    expect(getSsrfSafeFetchAgent()).toBeUndefined();
  });
});

describe('assertPublicHost', () => {
  afterEach(() => {
    delete process.env.TEABLE_SSRF_PROTECTION_DISABLED;
  });

  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '[::1]', 'localhost'])(
    'rejects %s',
    async (host) => {
      await expect(assertPublicHost(host)).rejects.toThrow();
    }
  );

  it('accepts a public address', async () => {
    await expect(assertPublicHost('93.184.216.34')).resolves.toBeUndefined();
  });

  it('skips the check when SSRF protection is disabled', async () => {
    process.env.TEABLE_SSRF_PROTECTION_DISABLED = 'true';
    await expect(assertPublicHost('127.0.0.1')).resolves.toBeUndefined();
  });
});
