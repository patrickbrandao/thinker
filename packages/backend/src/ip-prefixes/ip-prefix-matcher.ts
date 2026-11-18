import { BlockList, isIP } from 'node:net';
import { normalizeIp, parsePrefix } from '../common/utils/client-ip';

export const MAX_ENTRIES_PER_LIST = 1000;

/**
 * Canonical `ip/len` for one list entry: a single address becomes /32 or
 * /128; the address is normalized (IPv4-mapped IPv6 to IPv4, compressed IPv6
 * spelled the way `BlockList` reads it). Returns null when invalid.
 */
export function normalizePrefix(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const slash = value.indexOf('/');
  const address = normalizeIp(slash >= 0 ? value.slice(0, slash) : value);
  if (!address) return null;
  const parsed = parsePrefix(slash >= 0 ? `${address}${value.slice(slash)}` : address);
  if (!parsed) return null;
  return `${parsed.ip.toLowerCase()}/${parsed.len}`;
}

/** Whether a client address falls inside any of the given prefixes. */
export interface IpMatcher {
  contains(ip: string): boolean;
}

export function buildMatcher(prefixes: readonly string[]): IpMatcher {
  const list = new BlockList();
  for (const p of prefixes) {
    const parsed = parsePrefix(p);
    if (parsed) list.addSubnet(parsed.ip, parsed.len, parsed.family);
  }
  return {
    contains(ip: string) {
      const normalized = normalizeIp(ip);
      if (!normalized) return false;
      const version = isIP(normalized);
      return list.check(normalized, version === 4 ? 'ipv4' : 'ipv6');
    },
  };
}
