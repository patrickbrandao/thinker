import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { OutboundProxy } from './outbound-proxy';

/**
 * Balanced profile lines (tmp/PROXY-BALANCE-SPEC.md): which proxies of a line
 * a request tries, in which order.
 *
 * - Session affinity: rendezvous hash of the session (the root session of the
 *   Sessions page) over the line's proxies. Stateless, equal on every replica;
 *   adding or removing a proxy remaps only ~1/N of the sessions.
 * - Per request: round-robin per profile line (per process).
 * - A proxy error puts the proxy in quarantine for 30 s (per process); balanced
 *   lines skip it while it lasts.
 */
export type BalanceMode = 'affinity' | 'request';
export type BalanceOnFailure = 'next_member' | 'next_line';
export type BalanceNoSession = 'request' | 'agent' | 'first';

export interface EgressGroup {
  kind: 'group';
  /** Round-robin counter key: workspace, profile and line. */
  key: string;
  mode: BalanceMode;
  members: OutboundProxy[];
  onFailure: BalanceOnFailure;
  noSession: BalanceNoSession;
}

/** Who a request belongs to, for session affinity. */
export interface EgressAffinity {
  /** Root harness session (subagents fold into their main session). */
  sessionKey?: string | null;
  /** Agent id, used when the line asks for agent affinity without a session. */
  agentKey?: string | null;
}

const affinityStorage = new AsyncLocalStorage<EgressAffinity>();

export function runWithEgressAffinity<T>(affinity: EgressAffinity, fn: () => T): T {
  return affinityStorage.run(affinity, fn);
}

export function currentEgressAffinity(): EgressAffinity | null {
  return affinityStorage.getStore() ?? null;
}

export const QUARANTINE_MS = 30_000;
const MAX_STATE = 10_000;
const quarantine = new Map<string, number>();
const counters = new Map<string, number>();

function bounded<K, V>(map: Map<K, V>): void {
  if (map.size <= MAX_STATE) return;
  const first = map.keys().next().value;
  if (first !== undefined) map.delete(first);
}

export function quarantineProxy(proxyId: string, now = Date.now()): void {
  quarantine.delete(proxyId);
  quarantine.set(proxyId, now + QUARANTINE_MS);
  bounded(quarantine);
}

export function isQuarantined(proxyId: string, now = Date.now()): boolean {
  const until = quarantine.get(proxyId);
  if (until === undefined) return false;
  if (until <= now) {
    quarantine.delete(proxyId);
    return false;
  }
  return true;
}

export function resetBalanceStateForTests(): void {
  quarantine.clear();
  counters.clear();
}

function score(key: string, proxyId: string): bigint {
  return createHash('sha1').update(`${key}\u0000${proxyId}`).digest().readBigUInt64BE(0);
}

/** Proxies ordered by rendezvous score for `key` (highest first). */
export function rendezvousOrder<T extends { id: string }>(key: string, members: T[]): T[] {
  return members
    .map((member) => ({ member, score: score(key, member.id) }))
    .sort((a, b) =>
      a.score === b.score ? a.member.id.localeCompare(b.member.id) : a.score > b.score ? -1 : 1,
    )
    .map((x) => x.member);
}

export interface GroupPlan {
  /** Proxies to try, in order. */
  order: OutboundProxy[];
  /** Members reported as skipped when the line has nothing to try. */
  skipped: Array<{ proxy: OutboundProxy; result: 'skipped_disabled' | 'skipped_quarantine' }>;
  /** How the order was chosen. */
  strategy: 'affinity' | 'request' | 'first';
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * What a balanced line tries. Disabled proxies never take part. Quarantined
 * ones are skipped unless the whole line is quarantined and it is the last
 * line (then it is tried anyway rather than failing closed).
 */
export function planGroup(
  group: EgressGroup,
  isLastLine: boolean,
  affinity: EgressAffinity | null = currentEgressAffinity(),
  options: { now?: number; random?: () => number } = {},
): GroupPlan {
  const now = options.now ?? Date.now();
  const random = options.random ?? Math.random;
  const enabled = group.members.filter((p) => p.enabled);
  if (enabled.length === 0) {
    return {
      order: [],
      skipped: group.members.map((proxy) => ({ proxy, result: 'skipped_disabled' as const })),
      strategy: group.mode,
    };
  }
  let healthy = enabled.filter((p) => !isQuarantined(p.id, now));
  if (healthy.length === 0) {
    if (!isLastLine) {
      return {
        order: [],
        skipped: enabled.map((proxy) => ({ proxy, result: 'skipped_quarantine' as const })),
        strategy: group.mode,
      };
    }
    healthy = enabled;
  }

  let key: string | null = null;
  let strategy: GroupPlan['strategy'] = 'request';
  if (group.mode === 'affinity') {
    if (affinity?.sessionKey) {
      key = `session:${affinity.sessionKey}`;
    } else if (group.noSession === 'agent' && affinity?.agentKey) {
      key = `agent:${affinity.agentKey}`;
    } else if (group.noSession === 'first') {
      strategy = 'first';
    }
    if (key) strategy = 'affinity';
  }

  let order: OutboundProxy[];
  if (strategy === 'affinity') {
    const ok = new Set(healthy.map((p) => p.id));
    order = rendezvousOrder(key!, enabled).filter((p) => ok.has(p.id));
  } else if (strategy === 'first') {
    order = healthy;
  } else {
    const n = counters.get(group.key) ?? 0;
    counters.delete(group.key);
    counters.set(group.key, (n + 1) % 1_000_000_000);
    bounded(counters);
    const start = healthy[n % healthy.length]!;
    order = [
      start,
      ...shuffle(
        healthy.filter((p) => p !== start),
        random,
      ),
    ];
  }
  if (group.onFailure === 'next_line') order = order.slice(0, 1);
  return { order, skipped: [], strategy };
}
