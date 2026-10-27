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

/** The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail is allowed). */
function v6Groups(address: string): number[] | undefined {
  let text = address.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parts = (s: string) => (s ? s.split(':') : []);
  const head = parts(halves[0]);
  const tail = halves.length === 2 ? parts(halves[1]) : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return undefined;
  const groups = [...head, ...Array<string>(gap).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.every((g) => g >= 0 && g <= 0xffff) ? groups : undefined;
}

const v4Of = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
const zeros = (groups: number[]) => groups.every((g) => g === 0);

/** True for addresses an outbound agent request must never reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.some((cidr) => inV4(address, cidr));
  if (family !== 6) return true;
  const g = v6Groups(address);
  if (!g) return true;
  // IPv6 forms that carry an IPv4 address are judged by that address: mapped ::ffff:0:0/96 (also
  // written ::ffff:7f00:1), SIIT ::ffff:0:0:0/96, compatible ::/96 (incl. :: and ::1), NAT64
  // 64:ff9b::/96 and 6to4 2002::/16
  if (zeros(g.slice(0, 5)) && g[5] === 0xffff) return isBlockedAddress(v4Of(g[6], g[7]));
  if (zeros(g.slice(0, 4)) && g[4] === 0xffff && g[5] === 0) {
    return isBlockedAddress(v4Of(g[6], g[7]));
  }
  if (zeros(g.slice(0, 6))) return isBlockedAddress(v4Of(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // the local-use NAT64 prefix 64:ff9b:1::/48 is site-specific: never
    return g[2] === 1 || !zeros(g.slice(2, 6)) || isBlockedAddress(v4Of(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isBlockedAddress(v4Of(g[1], g[2]));
  return (
    (g[0] === 0x2001 && g[1] === 0) || // Teredo 2001::/32 (tunnels to any IPv4 host)
    (g[0] === 0x2001 && g[1] === 0x0db8) || // documentation 2001:db8::/32
    (g[0] & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g[0] & 0xffc0) === 0xfec0 || // site-local fec0::/10 (deprecated)
    (g[0] & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (g[0] & 0xff00) === 0xff00 // multicast ff00::/8
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
