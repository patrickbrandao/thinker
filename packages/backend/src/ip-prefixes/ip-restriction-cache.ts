import type { DataSource } from 'typeorm';
import { buildMatcher, type IpMatcher } from './ip-prefix-matcher';

/**
 * Per-key source-IP restriction as the agent-key guard enforces it:
 * null = unrestricted; otherwise the matcher of every linked list (a key
 * restricted to lists with no entries accepts nobody — fail closed).
 *
 * Process-wide on purpose (the guard is instantiated per host module).
 * Changes made through IpPrefixesService clear it at once; other replicas
 * follow within TTL_MS.
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;
const cache = new Map<string, { matcher: IpMatcher | null; expiresAt: number }>();

export function clearIpRestrictionCache(): void {
  cache.clear();
}

export async function ipRestrictionFor(ds: DataSource, keyId: string): Promise<IpMatcher | null> {
  const now = Date.now();
  const hit = cache.get(keyId);
  if (hit && hit.expiresAt > now) return hit.matcher;

  const rows = (await ds.query(
    `SELECT k.ip_restriction_enabled AS enabled, l.entries
       FROM agent_api_keys k
       LEFT JOIN agent_api_key_ip_prefix_lists kl ON kl.key_id = k.id
       LEFT JOIN ip_prefix_lists l ON l.id = kl.list_id
      WHERE k.id = $1`,
    [keyId],
  )) as Array<{ enabled: boolean; entries: Array<{ prefix: string }> | null }>;

  let matcher: IpMatcher | null = null;
  if (rows[0]?.enabled) {
    const prefixes = rows.flatMap((r) => (r.entries ?? []).map((e) => e.prefix));
    matcher = buildMatcher(prefixes);
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(keyId, { matcher, expiresAt: now + TTL_MS });
  return matcher;
}
