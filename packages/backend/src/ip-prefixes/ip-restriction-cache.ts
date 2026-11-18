import type { DataSource } from 'typeorm';
import { buildMatcher, type IpMatcher } from './ip-prefix-matcher';

/**
 * Per-harness source-IP restriction as the agent-key guard enforces it:
 * null = unrestricted; otherwise the matcher of every linked list (a harness
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

export async function ipRestrictionFor(ds: DataSource, agentId: string): Promise<IpMatcher | null> {
  const now = Date.now();
  const hit = cache.get(agentId);
  if (hit && hit.expiresAt > now) return hit.matcher;

  const rows = (await ds.query(
    `SELECT a.ip_restriction_enabled AS enabled, l.entries
       FROM agents a
       LEFT JOIN agent_ip_prefix_lists al ON al.agent_id = a.id
       LEFT JOIN ip_prefix_lists l ON l.id = al.list_id
      WHERE a.id = $1`,
    [agentId],
  )) as Array<{ enabled: boolean; entries: Array<{ prefix: string }> | null }>;

  let matcher: IpMatcher | null = null;
  if (rows[0]?.enabled) {
    const prefixes = rows.flatMap((r) => (r.entries ?? []).map((e) => e.prefix));
    matcher = buildMatcher(prefixes);
  }
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(agentId, { matcher, expiresAt: now + TTL_MS });
  return matcher;
}
