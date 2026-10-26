import { isIP } from 'net';

/**
 * Where the agent's http_request may connect (design §9.3). Addresses are checked after DNS
 * resolution, and the connection then goes to the checked address, so a name cannot be
 * re-pointed at an internal service between the check and the request.
 */

const v4ToInt = (ip: string) =>
  ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

const inV4 = (ip: string, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
};

const blockedV4 = [
  '0.0.0.0/8', // "this" network
  '10.0.0.0/8',
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local, incl. the cloud metadata address 169.254.169.254
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, broadcast
];

/** True for addresses an outbound agent request must never reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.some((cidr) => inV4(address, cidr));
  if (family !== 6) return true;
  const ip = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isBlockedAddress(mapped[1]);
  return (
    ip === '::' ||
    ip === '::1' ||
    /^fe[89ab]/.test(ip) || // link-local fe80::/10
    /^f[cd]/.test(ip) || // unique local fc00::/7
    /^ff/.test(ip) // multicast
  );
}

/** `api.github.com` matches itself; `*.example.com` matches subdomains (not the apex). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.trim().toLowerCase().replace(/\.$/, '');
  if (!p) return false;
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/**
 * Whether a URL's host is on the list. A pattern with a port (`api.local:8443`) must match host
 * and port; one without matches the host name on any port.
 */
export const hostAllowed = (url: { hostname: string; host: string }, patterns: readonly string[]) =>
  patterns.some((p) =>
    /:\d+$/.test(p.trim())
      ? url.host.toLowerCase() === p.trim().toLowerCase()
      : hostMatches(url.hostname, p)
  );

/** Hosts the agent may call without a credential (comma or space separated env list). */
export const parseHostList = (value: string | undefined) =>
  (value ?? '')
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
