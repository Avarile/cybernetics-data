/* eslint-disable @typescript-eslint/naming-convention */
import { lookup } from 'dns/promises';
import { BlockList } from 'net';
import type {
  RequestFilteringHttpAgent,
  RequestFilteringHttpsAgent,
} from 'request-filtering-agent';
import { globalHttpAgent, globalHttpsAgent } from 'request-filtering-agent';

const isSsrfProtectionDisabled = () => process.env.TEABLE_SSRF_PROTECTION_DISABLED === 'true';

// Both agents are always returned to prevent redirect-based SSRF bypass
// (e.g., http://evil.com redirects to https://169.254.169.254)
const EMPTY_AGENTS = {};
const SAFE_AGENTS = { httpAgent: globalHttpAgent, httpsAgent: globalHttpsAgent };

/**
 * Returns SSRF-safe HTTP agents for use with axios.
 * When SSRF protection is disabled via env var, returns an empty object
 * so that axios uses its default agents.
 *
 * Usage: `axios.get(url, { ...getSsrfSafeAgents() })`
 */
export function getSsrfSafeAgents(): {
  httpAgent?: RequestFilteringHttpAgent;
  httpsAgent?: RequestFilteringHttpsAgent;
} {
  if (isSsrfProtectionDisabled()) {
    return EMPTY_AGENTS;
  }
  return SAFE_AGENTS;
}

/**
 * Returns an SSRF-safe agent selector for node-fetch, or undefined when SSRF
 * protection is disabled. node-fetch passes the same option to every redirect
 * hop, so a redirect to a private address is also blocked.
 *
 * Usage: `fetch(url, { agent: getSsrfSafeFetchAgent() })`
 */
export function getSsrfSafeFetchAgent():
  | ((parsedUrl: URL) => RequestFilteringHttpAgent | RequestFilteringHttpsAgent)
  | undefined {
  if (isSsrfProtectionDisabled()) {
    return undefined;
  }
  return (parsedUrl: URL) => (parsedUrl.protocol === 'http:' ? globalHttpAgent : globalHttpsAgent);
}

const privateAddresses = (() => {
  const list = new BlockList();
  list.addSubnet('0.0.0.0', 8, 'ipv4');
  list.addSubnet('10.0.0.0', 8, 'ipv4');
  list.addSubnet('100.64.0.0', 10, 'ipv4');
  list.addSubnet('127.0.0.0', 8, 'ipv4');
  list.addSubnet('169.254.0.0', 16, 'ipv4');
  list.addSubnet('172.16.0.0', 12, 'ipv4');
  list.addSubnet('192.168.0.0', 16, 'ipv4');
  list.addSubnet('224.0.0.0', 4, 'ipv4');
  list.addSubnet('240.0.0.0', 4, 'ipv4');
  list.addAddress('::', 'ipv6');
  list.addAddress('::1', 'ipv6');
  list.addSubnet('fc00::', 7, 'ipv6');
  list.addSubnet('fe80::', 10, 'ipv6');
  list.addSubnet('ff00::', 8, 'ipv6');
  return list;
})();

const isPrivateAddress = (address: string, family: number) => {
  // IPv4-mapped IPv6 addresses (::ffff:10.0.0.1) are checked as IPv4.
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return privateAddresses.check(mapped[1], 'ipv4');
  }
  return privateAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
};

/**
 * Rejects a hostname that resolves to a private, loopback or link-local address.
 * Use it only where the request cannot go through getSsrfSafeFetchAgent(): it
 * checks DNS once, so it does not cover redirects or DNS rebinding.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (isSsrfProtectionDisabled()) {
    return;
  }
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address, a.family))) {
    throw new Error(`Host ${hostname} resolves to a private address`);
  }
}
