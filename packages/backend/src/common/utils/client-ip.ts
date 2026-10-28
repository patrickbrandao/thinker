import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/**
 * Client address behind a reverse proxy (skill
 * `docker-reverse-proxy-real-ip-address`). The TCP peer is the only value a
 * client cannot forge; `X-Forwarded-For` and `X-Real-IP` are read only when
 * that peer is a trusted proxy, and XFF is walked right to left.
 *
 * The trusted set is either the default private ranges below or, when
 * `TRUSTED_PROXIES` has a value, only the prefixes it lists.
 */

export const DEFAULT_TRUSTED_PROXIES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
  '2001:db8::/32',
  '4000::/2',
  '8000::/1',
] as const;

export type TrustedProxiesMode = 'default' | 'env';
export type ClientIpSource = 'x-forwarded-for' | 'x-real-ip' | 'tcp';

export interface TrustedProxies {
  mode: TrustedProxiesMode;
  /** Effective prefixes, normalized to `ip/len`. */
  prefixes: string[];
  contains(ip: string): boolean;
}

export interface ClientIpInfo {
  clientIp: string;
  source: ClientIpSource;
  peerIp: string;
}

/** Internal headers the resolver stamps on every request (client values are overwritten). */
export const CLIENT_IP_HEADER = 'x-thinker-client-ip';
export const CLIENT_IP_SOURCE_HEADER = 'x-thinker-client-ip-source';
export const PEER_IP_HEADER = 'x-thinker-peer-ip';

const MAX_XFF_CHARS = 2048;
const MAX_XFF_HOPS = 30;

export class TrustedProxiesError extends Error {
  constructor(entry: string) {
    super(
      `TRUSTED_PROXIES has an invalid entry: "${entry}". Use IPv4/IPv6 addresses or CIDR prefixes separated by commas.`,
    );
    this.name = 'TrustedProxiesError';
  }
}

/**
 * Normalizes an address: drops the port (`1.2.3.4:5555`, `[2001:db8::1]:443`),
 * the IPv6 zone (`%eth0`) and the IPv4-mapped prefix (`::ffff:1.2.3.4`).
 * Returns null when the value is not an IP literal.
 */
export function normalizeIp(raw: string | undefined | null): string | null {
  let value = (raw ?? '').trim();
  if (!value) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  if (/^::ffff:[\d.]+$/i.test(value)) value = value.slice(7);
  return isIP(value) === 0 ? null : value;
}

function parsePrefix(entry: string): { ip: string; len: number; family: 'ipv4' | 'ipv6' } | null {
  const [address, length, extra] = entry.split('/');
  if (extra !== undefined) return null;
  const version = isIP(address);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  if (length !== undefined && !/^\d{1,3}$/.test(length)) return null;
  const len = length === undefined ? max : Number(length);
  if (len > max) return null;
  return { ip: address, len, family: version === 4 ? 'ipv4' : 'ipv6' };
}

function buildSet(entries: readonly string[], mode: TrustedProxiesMode): TrustedProxies {
  const list = new BlockList();
  const prefixes: string[] = [];
  for (const entry of entries) {
    const prefix = parsePrefix(entry);
    if (!prefix) throw new TrustedProxiesError(entry);
    list.addSubnet(prefix.ip, prefix.len, prefix.family);
    prefixes.push(`${prefix.ip}/${prefix.len}`);
  }
  return {
    mode,
    prefixes,
    contains: (ip) => list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6'),
  };
}

/** Builds the trusted set from `TRUSTED_PROXIES`; throws on any invalid entry. */
export function loadTrustedProxies(raw: string | undefined): TrustedProxies {
  if (raw === undefined || raw.trim() === '') return buildSet(DEFAULT_TRUSTED_PROXIES, 'default');
  return buildSet(
    raw.split(',').map((item) => item.trim()),
    'env',
  );
}

let active: TrustedProxies | null = null;

/** The set loaded at boot (the default ranges when boot did not configure one). */
export function trustedProxies(): TrustedProxies {
  return (active ??= loadTrustedProxies(undefined));
}

export function setTrustedProxies(set: TrustedProxies): void {
  active = set;
}

interface ResolveInput {
  peer: string | undefined;
  /** Every `X-Forwarded-For` occurrence, in order. */
  forwardedFor?: readonly string[];
  /** Every `X-Real-IP` occurrence; only the first counts. */
  realIp?: readonly string[];
}

/** The XFF entries to consider: the rightmost ones within the size limits. */
function forwardedHops(occurrences: readonly string[]): string[] {
  let joined = occurrences.join(',');
  if (joined.length > MAX_XFF_CHARS) {
    joined = joined.slice(-MAX_XFF_CHARS);
    // The leftmost fragment may be cut in half; keep whole entries only.
    joined = joined.slice(joined.indexOf(',') + 1);
  }
  return joined.split(',').slice(-MAX_XFF_HOPS);
}

/**
 * Resolves the client address of one request. `onTcpFallback` fires when a
 * trusted proxy sent no usable forwarding header.
 */
export function resolveClientIp(
  input: ResolveInput,
  trusted: TrustedProxies,
  onTcpFallback?: (peer: string) => void,
): ClientIpInfo {
  const peerIp = normalizeIp(input.peer) ?? input.peer ?? 'unknown';
  const tcp: ClientIpInfo = { clientIp: peerIp, source: 'tcp', peerIp };
  if (isIP(peerIp) === 0 || !trusted.contains(peerIp)) return tcp;

  const occurrences = (input.forwardedFor ?? []).filter((v) => v.trim() !== '');
  if (occurrences.length > 0) {
    const hops = forwardedHops(occurrences);
    let valid = true;
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = normalizeIp(hops[i]);
      if (!ip) {
        valid = false;
        break;
      }
      if (!trusted.contains(ip)) return { clientIp: ip, source: 'x-forwarded-for', peerIp };
    }
    const leftmost = valid ? normalizeIp(hops[0]) : null;
    if (leftmost) return { clientIp: leftmost, source: 'x-forwarded-for', peerIp };
  }

  const realIp = normalizeIp(input.realIp?.[0]);
  if (realIp) return { clientIp: realIp, source: 'x-real-ip', peerIp };

  onTcpFallback?.(peerIp);
  return tcp;
}

const CONTEXT_KEY = Symbol('thinker.clientIp');

type WithClientIp = IncomingMessage & { [CONTEXT_KEY]?: ClientIpInfo };

/** Resolves once per request and keeps the result on it. */
export function clientIpInfo(
  req: IncomingMessage,
  onTcpFallback?: (peer: string) => void,
): ClientIpInfo {
  const holder = req as WithClientIp;
  if (holder[CONTEXT_KEY]) return holder[CONTEXT_KEY];
  const distinct = req.headersDistinct ?? {};
  const info = resolveClientIp(
    {
      peer: req.socket?.remoteAddress,
      forwardedFor: distinct['x-forwarded-for'],
      realIp: distinct['x-real-ip'],
    },
    trustedProxies(),
    onTcpFallback,
  );
  holder[CONTEXT_KEY] = info;
  return info;
}

/** `client_ip=… client_ip_source=… peer_ip=…` for log lines. */
export function clientIpLogFields(req: IncomingMessage): string {
  const { clientIp, source, peerIp } = clientIpInfo(req);
  return `client_ip=${clientIp} client_ip_source=${source} peer_ip=${peerIp}`;
}
