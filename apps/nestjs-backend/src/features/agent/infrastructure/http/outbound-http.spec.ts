/* eslint-disable sonarjs/no-duplicate-string */
import type { IAgentConfig } from '../../../../configs/agent.config';
import type { ICredentialRef } from '../../domain/entities';
import type { IAgentStorePort, ISecretVaultPort } from '../../domain/ports';
import { hostAllowed, hostMatches, isBlockedAddress, parseHostList } from './network-policy';
import { inject, OutboundHttp, scrub, secretForms } from './outbound-http';

describe('network policy', () => {
  it('blocks private, loopback, link-local, metadata and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      'not-an-ip',
    ]) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ['8.8.8.8', '140.82.112.3', '172.32.0.1', '2606:4700:4700::1111']) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, false]);
    }
  });

  it('matches hosts exactly, by subdomain wildcard, and with ports', () => {
    expect(hostMatches('api.github.com', 'api.github.com')).toBe(true);
    expect(hostMatches('API.GitHub.com.', 'api.github.com')).toBe(true);
    expect(hostMatches('evil-api.github.com', 'api.github.com')).toBe(false);
    expect(hostMatches('uploads.github.com', '*.github.com')).toBe(true);
    expect(hostMatches('github.com', '*.github.com')).toBe(false);
    expect(hostMatches('github.com.evil.io', '*.github.com')).toBe(false);
    const url = new URL('https://api.local:8443/x');
    expect(hostAllowed(url, ['api.local:8443'])).toBe(true);
    expect(hostAllowed(url, ['api.local:9443'])).toBe(false);
    expect(hostAllowed(url, ['api.local'])).toBe(true);
    expect(parseHostList('a.com, b.com  c.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('injects the secret by credential kind and scrubs every form of it', () => {
    const url = new URL('https://api.x.com/v1');
    const headers: Record<string, string> = {};
    inject({ authKind: 'bearer', headerName: null, queryParam: null }, 'tok123', url, headers);
    expect(headers.authorization).toBe('Bearer tok123');
    inject({ authKind: 'header', headerName: 'X-Api-Key', queryParam: null }, 'k1', url, headers);
    expect(headers['x-api-key']).toBe('k1');
    inject({ authKind: 'query_param', headerName: null, queryParam: 'key' }, 'q1', url, headers);
    expect(url.searchParams.get('key')).toBe('q1');
    inject({ authKind: 'basic', headerName: null, queryParam: null }, 'me:pw', url, headers);
    expect(headers.authorization).toBe(`Basic ${Buffer.from('me:pw').toString('base64')}`);
    expect(() =>
      inject(
        { authKind: 'oauth2_client_credentials', headerName: null, queryParam: null },
        'x',
        url,
        headers
      )
    ).toThrow(/not supported/);

    const forms = secretForms('me:pw:long', 'basic');
    const b64 = Buffer.from('me:pw:long').toString('base64');
    expect(scrub(`token me:pw:long and ${b64} and me%3Apw%3Along`, forms)).toBe(
      'token [redacted] and [redacted] and [redacted]'
    );
  });
});

describe('OutboundHttp guard', () => {
  const credential = {
    id: 'recC',
    name: 'github',
    authKind: 'bearer',
    allowedHosts: ['api.github.com'],
    allowedMethods: ['GET'],
    status: 'set',
    expiresAt: null,
  } as unknown as ICredentialRef;
  const make = (config: Partial<IAgentConfig> = {}, cred: Partial<ICredentialRef> = {}) =>
    new OutboundHttp(
      {
        httpAllowedHosts: 'localhost,127.0.0.1,169.254.169.254,10.0.0.5',
        httpAllowPrivateNetworks: false,
        httpTimeoutMs: 2000,
        httpMaxResponseBytes: 1000,
        ...config,
      },
      {
        getCredentialByName: async (n: string) =>
          n === 'github' ? { ...credential, ...cred } : undefined,
        updateCredential: async () => credential,
      } as unknown as IAgentStorePort,
      { reveal: async () => 'secret-token-1' } as unknown as ISecretVaultPort
    );

  it('refuses private addresses even when the host is allowed', async () => {
    const http = make();
    for (const url of [
      'http://127.0.0.1:1/',
      'http://localhost:1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://[::ffff:127.0.0.1]:1/',
    ]) {
      await expect(http.request({ method: 'GET', url })).rejects.toThrow(/private|not allowed/);
    }
  });

  it('refuses hosts that are not allowed, bad schemes and URL credentials', async () => {
    const http = make();
    await expect(http.request({ method: 'GET', url: 'https://example.org/' })).rejects.toThrow(
      /not allowed/
    );
    await expect(http.request({ method: 'GET', url: 'file:///etc/passwd' })).rejects.toThrow(
      /Only http/
    );
    await expect(
      http.request({ method: 'GET', url: 'https://u:p@api.github.com/' })
    ).rejects.toThrow(/credential/);
  });

  it('keeps a credential to its hosts, methods, status and expiry', async () => {
    await expect(
      make().request({ method: 'GET', url: 'https://evil.com/', credential: 'github' })
    ).rejects.toThrow(/only be sent to api.github.com/);
    await expect(
      make().request({ method: 'POST', url: 'https://api.github.com/', credential: 'github' })
    ).rejects.toThrow(/allows GET only/);
    await expect(
      make({}, { status: 'missing' }).request({
        method: 'GET',
        url: 'https://api.github.com/',
        credential: 'github',
      })
    ).rejects.toThrow(/not set/);
    await expect(
      make({}, { expiresAt: '2020-01-01' }).request({
        method: 'GET',
        url: 'https://api.github.com/',
        credential: 'github',
      })
    ).rejects.toThrow(/expired/);
    await expect(
      make().request({ method: 'GET', url: 'https://api.github.com/', credential: 'nope' })
    ).rejects.toThrow(/credential_request/);
  });
});
